import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { CliTool } from "@/features/terminal/cli-registry";
import { isRenamableTab, resolveTabTitle, type Tab } from "./types";
import { TabContextMenu } from "./TabContextMenu";
import { NewTabContextMenu, NewTabMenu } from "./NewTabMenu";
import { TabOverflowMenu } from "./TabOverflowMenu";
import { TabStatusDot } from "./TabStatusDot";
import { TabTooltip } from "./TabTooltip";
import { TabWorktreePill } from "./TabWorktreePill";
import { Tooltip } from "@/components/ui/Tooltip";
import { useListReorder } from "@/components/ui/useListReorder";
import { useTabsStore } from "./tabsStore";
import { renderTabIcon, syncGhostRadii } from "./tabChrome";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (keepId: string) => void;
  onCloseAll: () => void;
  onCopyTabPath: (id: string) => void;
  onRevealTabInFinder: (id: string) => void;
  onCopyTabCwd: (id: string) => void;
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
  /** Commit a manual rename. Empty string after trim means "clear user override". */
  onRenameTab: (id: string, newTitle: string) => void;
  /** Move tab `id` to absolute `toIndex` within the bucket. */
  onMoveTab: (id: string, toIndex: number) => void;
  trailing?: React.ReactNode;
}

/* Initial estimate for the trailing strip's width, replaced on first paint by
   a ResizeObserver measuring the real strip. Used so the scroll container's
   right-padding and the fade gradient line up exactly with the strip's edge,
   even when its contents (e.g. the SC change-count) grow. */
const TRAILING_PX_FALLBACK = 44;
/* Pointer travel before a press promotes to a drag. Matches MiniProjectSidebar's
   tuned threshold: small enough that a deliberate drag feels immediate, large
   enough that pointer oscillation during a tap doesn't fire it accidentally. */
const DRAG_THRESHOLD_PX = 6;
/* While dragging, start auto-scrolling the bar horizontally once the pointer
   crosses into the inner edge band (in px). */
const AUTO_SCROLL_EDGE_PX = 36;
/* Max scroll delta applied per animation frame at the very edge. */
const AUTO_SCROLL_MAX_PER_FRAME = 14;
const RENAME_MAX_LENGTH = 60;

export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCopyTabPath,
  onRevealTabInFinder,
  onCopyTabCwd,
  onNewTerminal,
  onLaunchCli,
  onRenameTab,
  onMoveTab,
  trailing,
}: TabBarProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const trailingRef = useRef<HTMLDivElement | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const getItemElRef = useRef<(id: string) => HTMLElement | null>(() => null);
  const draggingIdRef = useRef<string | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [trailingWidth, setTrailingWidth] = useState(
    trailing ? TRAILING_PX_FALLBACK : 0,
  );

  const editingTabId = useTabsStore((s) => s.editingTabId);
  const setEditingTabId = useTabsStore((s) => s.setEditingTabId);

  const drag = useListReorder({
    ids: tabs.map((tab) => tab.id),
    onReorder: (_orderedIds, id, insertAt) => onMoveTab(id, insertAt),
    axis: "x",
    thresholdPx: DRAG_THRESHOLD_PX,
    bodyClass: "is-reordering-tabs",
    dragDisabled: (id) => editingTabId === id || tabs.length < 2,
    autoScroll: {
      containerRef: scrollRef,
      edgePx: AUTO_SCROLL_EDGE_PX,
      maxPerFrame: AUTO_SCROLL_MAX_PER_FRAME,
      endInsetPx: trailingWidth,
    },
    onPointerMove: ({ x, y }) => {
      const ghost = dragGhostRef.current;
      if (!ghost) return;
      ghost.style.transform = `translate3d(${x + 10}px, ${y - 10}px, 0)`;
      syncGhostRadii(
        ghost,
        getItemElRef.current,
        tabsRef.current.map((tab) => tab.id),
        draggingIdRef.current,
      );
    },
  });
  getItemElRef.current = drag.getItemEl;
  draggingIdRef.current = drag.draggingId;

  useEffect(() => {
    const el = trailingRef.current;
    if (!trailing || !el) {
      setTrailingWidth(0);
      return;
    }
    const sync = () => setTrailingWidth(el.offsetWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [trailing]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const hasOverflow = el.scrollWidth > el.clientWidth + 1;
      if (!hasOverflow) return;
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const thumb = thumbRef.current;
    if (!el || !thumb) return;

    const trailingPad = trailingWidth;

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const trackWidth = clientWidth - trailingPad;
      const hasOverflow = scrollWidth > clientWidth + 1;
      setOverflowing(hasOverflow);
      el.classList.toggle("is-overflowing", hasOverflow);
      if (!hasOverflow || trackWidth <= 0) {
        thumb.style.opacity = "0";
        thumb.style.width = "0px";
        return;
      }
      const ratio = trackWidth / scrollWidth;
      const thumbWidth = Math.max(28, trackWidth * ratio);
      const scrollable = scrollWidth - clientWidth;
      const progress = scrollable > 0 ? scrollLeft / scrollable : 0;
      const thumbLeft = progress * (trackWidth - thumbWidth);
      thumb.style.opacity = "1";
      thumb.style.width = `${thumbWidth}px`;
      thumb.style.transform = `translateX(${thumbLeft}px)`;
    };

    let rafId = 0;
    const schedule = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    update();
    el.addEventListener("scroll", schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: false });

    return () => {
      cancelAnimationFrame(rafId);
      el.removeEventListener("scroll", schedule);
      ro.disconnect();
      mo.disconnect();
    };
  }, [trailing, trailingWidth, tabs.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeTabId) return;
    const node = el.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeTabId)}"]`,
    );
    if (!node) return;
    const nodeLeft = node.offsetLeft;
    const nodeRight = nodeLeft + node.offsetWidth;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth - trailingWidth;
    if (nodeLeft < viewLeft) {
      el.scrollTo({ left: nodeLeft - 24, behavior: "auto" });
    } else if (nodeRight > viewRight) {
      el.scrollTo({
        left: nodeRight - el.clientWidth + trailingWidth + 24,
        behavior: "auto",
      });
    }
  }, [activeTabId, tabs.length, trailing, trailingWidth]);

  const indicatorLeft = (() => {
    if (drag.draggingId === null || drag.dropIndex === null) return null;
    const sourceIdx = tabs.findIndex((tt) => tt.id === drag.draggingId);
    if (drag.dropIndex === sourceIdx || drag.dropIndex === sourceIdx + 1) return null;
    const el = scrollRef.current;
    if (!el) return null;
    if (drag.dropIndex >= tabs.length) {
      const last = tabs[tabs.length - 1];
      const lastEl = last ? drag.getItemEl(last.id) : null;
      if (!lastEl) return null;
      return lastEl.offsetLeft + lastEl.offsetWidth - el.scrollLeft - 1;
    }
    const target = tabs[drag.dropIndex];
    const targetEl = target ? drag.getItemEl(target.id) : null;
    if (!targetEl) return null;
    return targetEl.offsetLeft - el.scrollLeft - 1;
  })();

  return (
    <NewTabContextMenu onNewTerminal={onNewTerminal} onLaunchCli={onLaunchCli}>
    <div
      className="relative z-20 h-[var(--panel-header-h)]"
      data-tauri-drag-region
    >
      <div
        ref={scrollRef}
        className={cn(
          "tab-scroll absolute inset-x-0 top-0 bottom-0 flex min-w-0 items-end overflow-x-auto overflow-y-hidden px-6px pt-4px",
        )}
        style={trailing ? { paddingRight: trailingWidth } : undefined}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const isFileTab =
            tab.kind === "editor" ||
            tab.kind === "markdown" ||
            tab.kind === "image" ||
            tab.kind === "pdf";
          const isProcessTab = tab.kind === "terminal" || tab.kind === "cli";
          const renamable = isRenamableTab(tab);
          const editing = editingTabId === tab.id;
          const beingDragged = drag.draggingId === tab.id;
          const displayedTitle =
            tab.kind === "changes" ? t("v3.workbench.changes") : resolveTabTitle(tab);

          return (
            <div
              key={tab.id}
              ref={drag.itemRef(tab.id)}
              {...drag.getItemProps(tab.id)}
              className={cn(
                "chrome-tab-slot touch-none",
                active && "is-active",
                editing && "is-editing",
              )}
              data-tab-id={tab.id}
            >
            <TabContextMenu
              tab={tab}
              totalTabs={tabs.length}
              isActive={active}
              onSelect={() => onSelect(tab.id)}
              onClose={() => onClose(tab.id)}
              onCloseOthers={() => onCloseOthers(tab.id)}
              onCloseAll={onCloseAll}
              onRename={
                renamable
                  ? () => {
                      requestAnimationFrame(() => setEditingTabId(tab.id));
                    }
                  : undefined
              }
              onResetTitle={
                renamable && tab.userTitle
                  ? () => onRenameTab(tab.id, "")
                  : undefined
              }
              onCopyPath={isFileTab ? () => onCopyTabPath(tab.id) : undefined}
              onRevealInFinder={
                isFileTab ? () => onRevealTabInFinder(tab.id) : undefined
              }
              onCopyCwd={isProcessTab ? () => onCopyTabCwd(tab.id) : undefined}
            >
              <Tooltip
                content={editing ? null : <TabTooltip tab={tab} />}
                side="bottom"
                align="start"
              >
              <button
                type="button"
                onClick={() => onSelect(tab.id)}
                onDoubleClick={(e) => {
                  if (!renamable) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingTabId(tab.id);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) onClose(tab.id);
                }}
                onContextMenu={(e) => {
                  e.stopPropagation();
                }}
                className={cn(
                  "chrome-tab group flex h-full items-center gap-7px px-10px",
                  "touch-none border-0 bg-transparent text-left outline-none",
                  active ? "text-tab-active-text" : "text-muted hover:text-body",
                  beingDragged && "is-dragging",
                )}
                aria-current={active ? "page" : undefined}
              >
                {tab.dirty ? (
                  <span
                    className={cn(
                      "h-[6px] w-[6px] shrink-0 rounded-pill",
                      active ? "bg-tab-active-text" : "bg-ink",
                    )}
                    aria-label={t("tabs.unsavedChanges")}
                  />
                ) : null}
                {renderTabIcon(tab, active)}
                {tab.kind === "terminal" || tab.kind === "cli" ? (
                  <TabStatusDot tabId={tab.id} />
                ) : null}
                {editing ? (
                  <TabRenameInput
                    initial={displayedTitle}
                    onCommit={(value) => {
                      onRenameTab(tab.id, value);
                      setEditingTabId(null);
                    }}
                    onCancel={() => setEditingTabId(null)}
                  />
                ) : (
                  <span className="tab-title min-w-0 flex-1 text-left text-caption">
                    {displayedTitle}
                  </span>
                )}
                <span className="tab-worktree">
                  <TabWorktreePill tab={tab} />
                </span>
                <span
                  data-no-drag
                  role="button"
                  tabIndex={-1}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className={cn(
                    "tab-close inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-xs transition-[opacity,background-color,color] duration-fast",
                    active
                      ? "text-tab-active-text opacity-70 hover:opacity-100"
                      : "text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-strong hover:text-ink",
                  )}
                  aria-label={t("tabs.closeTab")}
                >
                  <Icon icon={X} size={12} />
                </span>
              </button>
              </Tooltip>
            </TabContextMenu>
            </div>
          );
        })}
        <div
          className="chrome-tab-actions"
          data-no-drag
          style={trailing ? { right: trailingWidth } : undefined}
        >
          <NewTabMenu onNewTerminal={onNewTerminal} onLaunchCli={onLaunchCli} />
          {overflowing ? (
            <TabOverflowMenu
              tabs={tabs}
              activeTabId={activeTabId}
              onSelect={onSelect}
              onClose={onClose}
            />
          ) : null}
        </div>
      </div>

      {indicatorLeft !== null ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-[5px] bottom-[5px] z-[8] w-[2px] rounded-pill bg-ink"
          style={{ left: `${indicatorLeft}px` }}
        />
      ) : null}

      {trailing ? (
        <>
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-[18px] bg-gradient-to-r from-transparent to-canvas"
            style={{ right: trailingWidth }}
            aria-hidden="true"
          />
          <div
            ref={trailingRef}
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center gap-6px bg-canvas px-10px"
          >
            {trailing}
          </div>
        </>
      ) : null}
      <div
        ref={thumbRef}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 z-[5] h-px will-change-transform"
        style={{ width: 0, backgroundColor: "var(--scrollbar-tab-thumb)", opacity: 0 }}
      />

      {drag.draggingId && drag.pointerPos
        ? (() => {
            const dragged = tabs.find((tt) => tt.id === drag.draggingId);
            if (!dragged) return null;
            const sourceEl = drag.getItemEl(dragged.id);
            const ghostWidth = sourceEl?.offsetWidth ?? 160;
            return (
              <div
                ref={dragGhostRef}
                aria-hidden
                className="chrome-tab chrome-tab-ghost pointer-events-none fixed left-0 top-0 z-[60] flex h-[26px] items-center gap-7px px-10px text-caption text-ink will-change-transform"
                style={{
                  width: ghostWidth,
                  maxWidth: ghostWidth,
                  flex: "none",
                  transform: `translate3d(${drag.pointerPos.x + 10}px, ${drag.pointerPos.y - 10}px, 0)`,
                }}
              >
                {renderTabIcon(dragged, false)}
                <span className="tab-title min-w-0 flex-1 truncate">
                  {resolveTabTitle(dragged)}
                </span>
              </div>
            );
          })()
        : null}
    </div>
    </NewTabContextMenu>
  );
}

/* ---------- Inline rename input ---------- */

interface TabRenameInputProps {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

function TabRenameInput({ initial, onCommit, onCancel }: TabRenameInputProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement | null>(null);
  const settledRef = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCommit(ref.current?.value ?? "");
  };
  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={ref}
      type="text"
      defaultValue={initial}
      maxLength={RENAME_MAX_LENGTH}
      aria-label={t("tabs.renameInputLabel")}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        } else {
          e.stopPropagation();
        }
      }}
      onBlur={commit}
      className={cn(
        "flex-1 min-w-0 truncate rounded-xs border border-accent/60 bg-canvas px-4px",
        "text-left text-caption text-ink",
        "outline-none focus:border-accent focus:outline-none",
      )}
    />
  );
}
