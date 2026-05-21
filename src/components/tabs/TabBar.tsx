import { useEffect, useRef, type ReactNode } from "react";
import { X, TerminalSquare, AlertTriangle } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { FileIcon } from "@/components/file-explorer/FileIcon";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import { cn } from "@/lib/cn";
import type { CliTool } from "@/features/terminal/cli-registry";
import type { Tab } from "./types";
import { TabContextMenu } from "./TabContextMenu";
import { NewTabContextMenu } from "./NewTabMenu";

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
  trailing?: React.ReactNode;
}

// Tab icons mirror the source of the tab:
//   - CLI tabs → brand mark (Claude / Codex / OpenCode / …) so the active agent
//     is recognizable at a glance.
//   - File tabs → same FileIcon the explorer uses, keyed on the file extension,
//     so the tab bar visually matches the sidebar entry.
//   - Terminal tabs → generic terminal mark.
function renderTabIcon(tab: Tab, active: boolean): ReactNode {
  const tone = active ? "text-ink" : "text-muted-soft";

  if (tab.kind === "terminal") {
    return <Icon icon={TerminalSquare} size={13} className={tone} />;
  }
  if (tab.kind === "cli") {
    const BrandIcon = CLI_BRAND_ICONS[tab.cliId];
    if (BrandIcon) {
      return (
        <span className="inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center">
          <BrandIcon size={13} />
        </span>
      );
    }
    return <Icon icon={TerminalSquare} size={13} className={tone} />;
  }
  return (
    <FileIcon isDir={false} filename={tab.path} size={13} className={tone} />
  );
}

/* Width reserved on the right of the scroll area for the absolutely-positioned
   trailing menu. The "+" lives on top of the scroll layer and never shifts as
   tabs are added/removed/scrolled. Matches the `pr-[44px]` and `right-[44px]`
   literals below — keep them in sync. */
const TRAILING_PX = 44;

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
  trailing,
}: TabBarProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  // VS Code-style wheel → horizontal scroll. React's onWheel is passive, so
  // preventDefault() is silently ignored — we attach a native listener with
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

  // Custom 1px scroll thumb. Native scrollbar is hidden in CSS — we draw our
  // own line so the indicator is persistent (macOS overlay scrollbars would
  // otherwise vanish when idle) and uses a guaranteed high-contrast color.
  // The thumb sits flush against the bottom border, overlapping it where the
  // scroll is positioned — visually reads as "part of the border lights up
  // where you are in the scroll range".
  useEffect(() => {
    const el = scrollRef.current;
    const thumb = thumbRef.current;
    if (!el || !thumb) return;

    const trailingPad = trailing ? TRAILING_PX : 0;

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
  }, [trailing]);

  // After a layout change (tabs added/removed/active changes), keep the active
  // tab visible — scroll it into view if it's offscreen, accounting for the
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
    const viewRight = viewLeft + el.clientWidth - (trailing ? TRAILING_PX : 0);
    if (nodeLeft < viewLeft) {
      el.scrollTo({ left: nodeLeft - 24, behavior: "smooth" });
    } else if (nodeRight > viewRight) {
      el.scrollTo({
        left: nodeRight - el.clientWidth + (trailing ? TRAILING_PX : 0) + 24,
        behavior: "smooth",
      });
    }
  }, [activeTabId, tabs.length, trailing]);

  return (
    <NewTabContextMenu onNewTerminal={onNewTerminal} onLaunchCli={onLaunchCli}>
    <div
      className="relative z-20 h-[30px] border-b border-hairline bg-canvas-soft"
      data-tauri-drag-region
    >
      {/* The scroll container fills the row exactly. The native scrollbar is
          forced to 1px and sits flush against the bottom border — when there's
          overflow, it reads as a slightly brighter 1px segment along the
          existing hairline, never as a separate visual band. */}
      <div
        ref={scrollRef}
        className={cn(
          "tab-scroll absolute inset-x-0 top-0 bottom-0 flex min-w-0 items-stretch overflow-x-auto overflow-y-hidden",
          // Reserve room on the right so tabs don't slide under the
          // absolutely-positioned trailing menu.
          trailing && "pr-[44px]",
        )}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const isDangerous = tab.kind === "cli" && tab.cliId === "claude-code";
          const isFileTab =
            tab.kind === "editor" ||
            tab.kind === "markdown" ||
            tab.kind === "image" ||
            tab.kind === "pdf";
          const isProcessTab = tab.kind === "terminal" || tab.kind === "cli";
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
              onCopyPath={isFileTab ? () => onCopyTabPath(tab.id) : undefined}
              onRevealInFinder={
                isFileTab ? () => onRevealTabInFinder(tab.id) : undefined
              }
              onCopyCwd={isProcessTab ? () => onCopyTabCwd(tab.id) : undefined}
            >
              <button
                type="button"
                data-tab-id={tab.id}
                onClick={() => onSelect(tab.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) onClose(tab.id);
                }}
                onContextMenu={(e) => {
                  // Stop the right-click from bubbling to the outer bar menu so
                  // only the per-tab TabContextMenu opens here.
                  e.stopPropagation();
                }}
                className={cn(
                  "group relative flex h-[30px] min-w-[140px] max-w-[220px] shrink-0 items-center gap-[8px] border-r border-hairline px-[10px]",
                  "transition-colors duration-100",
                  active
                    ? "bg-canvas text-ink"
                    : "bg-canvas-soft text-muted hover:bg-surface-strong/40 hover:text-body",
                )}
                aria-current={active ? "page" : undefined}
              >
                {renderTabIcon(tab, active)}
                <span className="flex-1 truncate text-left font-mono text-[12px] tracking-tight">
                  {tab.title}
                </span>
                {isDangerous ? (
                  <Icon
                    icon={AlertTriangle}
                    size={11}
                    className="text-warn"
                    aria-label="Dangerous flag enabled"
                  />
                ) : null}
                {tab.dirty ? (
                  <span
                    className="h-[6px] w-[6px] rounded-full bg-ink"
                    aria-label="Unsaved changes"
                  />
                ) : null}
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className={cn(
                    "ml-auto inline-flex h-[18px] w-[18px] items-center justify-center rounded-xs text-muted opacity-0 transition-all duration-100",
                    "hover:bg-surface-strong/80 hover:text-ink group-hover:opacity-100",
                    active && "opacity-60",
                  )}
                  aria-label="Close tab"
                >
                  <Icon icon={X} size={11} />
                </span>
                {active ? <span className="tab-indicator" /> : null}
              </button>
            </TabContextMenu>
          );
        })}
      </div>
      {trailing ? (
        <>
          {/* Subtle fade so a tab being scrolled in/out doesn't crash into the
              hard edge of the trailing menu. */}
          <div
            className="pointer-events-none absolute right-[44px] top-0 bottom-0 w-[18px] bg-gradient-to-r from-transparent to-canvas-soft"
            aria-hidden="true"
          />
          <div
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center gap-[6px] border-l border-hairline bg-canvas-soft px-[10px]"
          >
            {trailing}
          </div>
        </>
      ) : null}
      {/* Custom 1px scroll thumb. Sits flush with the bottom border — when
          tabs overflow, a high-contrast segment of the border lights up to
          show scroll position. Width/transform driven by JS in the effect
          above. */}
      <div
        ref={thumbRef}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 z-[5] h-px will-change-transform"
        style={{ width: 0, backgroundColor: "var(--scrollbar-tab-thumb)", opacity: 0 }}
      />
    </div>
    </NewTabContextMenu>
  );
}
