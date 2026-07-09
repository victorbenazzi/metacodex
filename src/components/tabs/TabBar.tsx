import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X, TerminalSquare, GitCompare } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { FileIcon } from "@/components/file-explorer/FileIcon";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import { cn } from "@/lib/cn";
import type { CliTool } from "@/features/terminal/cli-registry";
import { isRenamableTab, resolveTabTitle, type Tab } from "./types";
import { TabContextMenu } from "./TabContextMenu";
import { NewTabContextMenu, NewTabMenu } from "./NewTabMenu";
import { TabStatusDot } from "./TabStatusDot";
import { TabTooltip } from "./TabTooltip";
import { TabWorktreePill } from "./TabWorktreePill";
import { Tooltip } from "@/components/ui/Tooltip";
import { useListReorder } from "@/components/ui/useListReorder";
import { useTabsStore } from "./tabsStore";

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

// Tab icons mirror the source of the tab:
//   - CLI tabs → brand mark (Claude / Codex / OpenCode / …) so the active agent
//     is recognizable at a glance.
//   - File tabs → same FileIcon the explorer uses, keyed on the file extension,
//     so the tab bar visually matches the sidebar entry.
//   - Terminal tabs → generic terminal mark.
function renderTabIcon(tab: Tab, active: boolean): ReactNode {
  // The active pill is ink-inverted, so its glyphs swap to the on-primary tone.
  const tone = active ? "text-on-primary" : "text-muted-soft";

  if (tab.kind === "terminal") {
    return <Icon icon={TerminalSquare} size={12} className={tone} />;
  }
  if (tab.kind === "cli") {
    const BrandIcon = CLI_BRAND_ICONS[tab.cliId];
    if (BrandIcon) {
      return (
        <span className="inline-flex h-[12px] w-[12px] shrink-0 items-center justify-center">
          <BrandIcon size={12} />
        </span>
      );
    }
    return <Icon icon={TerminalSquare} size={12} className={tone} />;
  }
  if (tab.kind === "diff") {
    return <Icon icon={GitCompare} size={12} className={tone} />;
  }
  return (
    <FileIcon isDir={false} filename={tab.path} size={12} className={tone} />
  );
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
  // Real width of the trailing strip; observed so the scroll padding and fade
  // line up exactly even as the pill expands (e.g. when the SC change count
  // grows to "99+").
  const [trailingWidth, setTrailingWidth] = useState(
    trailing ? TRAILING_PX_FALLBACK : 0,
  );

  // Inline rename: at most one tab can be in edit mode across the whole app,
  // so the bit lives in the global store. We read it as a selector so unrelated
  // tab updates don't re-render the bar.
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
  });

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

  // VS Code-style wheel → horizontal scroll. React's onWheel is passive, so
  // preventDefault() is silently ignored, so we attach a native listener with
  // { passive: false } and consume the event ourselves.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const hasOverflow = el.scrollWidth > el.clientWidth + 1;
      if (!hasOverflow) return;
      // Prefer the dominant axis: mouse wheels report deltaY only; trackpad
      // horizontal swipes report deltaX. Either way, scroll horizontally.
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Custom 1px scroll thumb. Native scrollbar is hidden in CSS, so we draw our
  // own line so the indicator is persistent (macOS overlay scrollbars would
  // otherwise vanish when idle) and uses a guaranteed high-contrast color.
  // The thumb sits flush against the bottom border, overlapping it where the
  // scroll is positioned. Visually this reads as the border lighting up
  // where you are in the scroll range.
  useEffect(() => {
    const el = scrollRef.current;
    const thumb = thumbRef.current;
    if (!el || !thumb) return;

    const trailingPad = trailingWidth;

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const trackWidth = clientWidth - trailingPad;
      const hasOverflow = scrollWidth > clientWidth + 1;
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
  }, [trailing, trailingWidth]);

  // After a layout change (tabs added/removed/active changes), keep the active
  // tab visible: scroll it into view if it's offscreen, accounting for the
  // reserved trailing-menu strip on the right.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeTabId) return;
    const node = el.querySelector<HTMLButtonElement>(
      `[data-tab-id="${CSS.escape(activeTabId)}"]`,
    );
    if (!node) return;
    const nodeLeft = node.offsetLeft;
    const nodeRight = nodeLeft + node.offsetWidth;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth - trailingWidth;
    if (nodeLeft < viewLeft) {
      el.scrollTo({ left: nodeLeft - 24, behavior: "smooth" });
    } else if (nodeRight > viewRight) {
      el.scrollTo({
        left: nodeRight - el.clientWidth + trailingWidth + 24,
        behavior: "smooth",
      });
    }
  }, [activeTabId, tabs.length, trailing, trailingWidth]);

  // Drop indicator X: center of the gap between two tabs.
  const indicatorLeft = (() => {
    if (drag.draggingId === null || drag.dropIndex === null) return null;
    const sourceIdx = tabs.findIndex((tt) => tt.id === drag.draggingId);
    // Hide on the two slots adjacent to the source. Dropping there is a no-op.
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
      {/* The scroll container fills the row exactly. The native scrollbar is
          forced to 1px and sits flush against the bottom border. When there's
          overflow, it reads as a slightly brighter 1px segment along the
          existing hairline, never as a separate visual band. */}
      <div
        ref={scrollRef}
        className={cn(
          "tab-scroll absolute inset-x-0 top-0 bottom-0 flex min-w-0 items-center gap-[4px] overflow-x-auto overflow-y-hidden px-[6px]",
        )}
        // Reserve room on the right so tabs don't slide under the
        // absolutely-positioned trailing strip. Width is measured dynamically
        // so the pill can grow (e.g. when the SC change count goes to "99+")
        // without overlapping the last tab.
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
          const displayedTitle = resolveTabTitle(tab);

          return (
            <TabContextMenu
              key={tab.id}
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
                      // TabContextMenu's onOpenChange already promotes to
                      // active. Defer one frame so the active-state update
                      // commits before the edit input mounts and tries to
                      // focus.
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
                ref={drag.itemRef(tab.id)}
                {...drag.getItemProps(tab.id)}
                data-tab-id={tab.id}
                onClick={() => onSelect(tab.id)}
                onDoubleClick={(e) => {
                  if (!renamable) return;
                  // Don't escalate to a select after a double-click on the
                  // title. Entering edit mode is the whole point.
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingTabId(tab.id);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) onClose(tab.id);
                }}
                onContextMenu={(e) => {
                  // Stop the right-click from bubbling to the outer bar menu so
                  // only the per-tab TabContextMenu opens here.
                  e.stopPropagation();
                }}
                className={cn(
                  "group relative flex h-[26px] min-w-[120px] max-w-[220px] shrink-0 items-center gap-[7px] rounded-md px-[10px]",
                  "touch-none transition-colors duration-fast",
                  active
                    ? "bg-ink text-on-primary"
                    : "text-muted hover:bg-canvas-soft hover:text-body",
                  beingDragged && "opacity-40",
                )}
                aria-current={active ? "page" : undefined}
              >
                {/* Dirty marker sits left of the icon, matching VS Code,
                    Cursor and JetBrains. Reading order: state, identity,
                    name, controls. */}
                {tab.dirty ? (
                  <span
                    className={cn(
                      "h-[6px] w-[6px] shrink-0 rounded-pill",
                      active ? "bg-on-primary" : "bg-ink",
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
                  <span className="flex-1 truncate text-left text-caption">
                    {displayedTitle}
                  </span>
                )}
                {/* Worktree pill sits at the trailing edge, just before close.
                    Branch identity is metadata, not part of the title scan. */}
                <TabWorktreePill tab={tab} />
                <span
                  data-no-drag
                  role="button"
                  tabIndex={-1}
                  onPointerDown={(e) => {
                    // Don't let the close X start a tab drag.
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className={cn(
                    "inline-flex h-[18px] w-[18px] items-center justify-center rounded-xs opacity-0 transition-all duration-fast group-hover:opacity-100",
                    active
                      ? "text-on-primary opacity-60 hover:opacity-100"
                      : "text-muted hover:bg-surface-strong hover:text-ink",
                  )}
                  aria-label={t("tabs.closeTab")}
                >
                  <Icon icon={X} size={12} />
                </span>
              </button>
              </Tooltip>
            </TabContextMenu>
          );
        })}
        {/* New-tab button rides right after the last pill, Codex-style. Same
            dropdown body as the bar's right-click menu. */}
        <div className="ml-[2px] flex shrink-0 items-center">
          <NewTabMenu onNewTerminal={onNewTerminal} onLaunchCli={onLaunchCli} />
        </div>
      </div>

      {/* Drop indicator is absolutely positioned in the bar (not inside the
          scroll container) so the indicator stays put while we recompute it
          from scrollLeft. Vertical line at the gap between two tabs. */}
      {indicatorLeft !== null ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-[5px] bottom-[5px] z-[8] w-[2px] rounded-pill bg-ink"
          style={{ left: `${indicatorLeft}px` }}
        />
      ) : null}

      {trailing ? (
        <>
          {/* Subtle fade so a tab being scrolled in/out doesn't crash into the
              hard edge of the trailing strip. */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-[18px] bg-gradient-to-r from-transparent to-canvas"
            style={{ right: trailingWidth }}
            aria-hidden="true"
          />
          <div
            ref={trailingRef}
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center gap-[6px] bg-canvas px-[10px]"
          >
            {trailing}
          </div>
        </>
      ) : null}
      {/* Custom 1px scroll thumb. Sits flush with the bottom border. When
          tabs overflow, a high-contrast segment of the border lights up to
          show scroll position. Width/transform driven by JS in the effect
          above. */}
      <div
        ref={thumbRef}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 z-[5] h-px will-change-transform"
        style={{ width: 0, backgroundColor: "var(--scrollbar-tab-thumb)", opacity: 0 }}
      />

      {/* Floating drag ghost: viewport-fixed, pointer-events:none so the
          underlying tabs can still receive pointermove. */}
      {drag.draggingId && drag.pointerPos
        ? (() => {
            const dragged = tabs.find((tt) => tt.id === drag.draggingId);
            if (!dragged) return null;
            return (
              <div
                aria-hidden
                className="pointer-events-none fixed z-[60] flex h-[26px] min-w-[120px] max-w-[220px] items-center gap-[7px] rounded-md border border-hairline bg-canvas px-[10px] text-caption text-ink shadow-drag"
                style={{
                  left: drag.pointerPos.x + 10,
                  top: drag.pointerPos.y - 10,
                }}
              >
                {renderTabIcon(dragged, true)}
                <span className="truncate">{resolveTabTitle(dragged)}</span>
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

/**
 * Inline text input that replaces the tab's title span while in edit mode.
 * Matches the surrounding font/size so the swap is layout-neutral. Stops
 * pointer/click bubbling so the parent button doesn't fire onSelect or start
 * a drag when the user clicks inside the field.
 */
function TabRenameInput({ initial, onCommit, onCancel }: TabRenameInputProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement | null>(null);
  // Track whether the input is mid-commit so blur doesn't double-fire.
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
          // Don't let editor / global shortcuts intercept while typing.
          e.stopPropagation();
        }
      }}
      onBlur={commit}
      className={cn(
        // Solid canvas: the input must stay readable over the ink-inverted
        // active pill, so it cannot be translucent.
        "flex-1 min-w-0 truncate rounded-xs border border-accent/60 bg-canvas px-[4px]",
        "text-left text-caption text-ink",
        "outline-none focus:border-accent focus:outline-none",
      )}
    />
  );
}
