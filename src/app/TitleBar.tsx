import { GitBranch, ArrowUp, ArrowDown, PanelRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";
import { isMac } from "@/lib/platform";
import { useGitStore } from "@/features/git/git.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSourceControlStore } from "@/features/source-control/sourceControl.store";
import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";

interface TitleBarProps {
  workspaceName?: string;
  className?: string;
}

/**
 * Top drag region. macOS Overlay titleBarStyle means traffic lights are inset at
 * top-left — we leave 78px of padding to keep them from overlapping app chrome.
 *
 * IMPORTANT: `data-tauri-drag-region` must appear on every element along the
 * click path. Without it on the inner spans, mousedown on the labels won't be
 * recognized as a drag and the window can't be moved. The Source Control toggle
 * is the lone exception — it deliberately omits the attribute so clicks reach it
 * instead of starting a window drag.
 */
export function TitleBar({ workspaceName, className }: TitleBarProps) {
  const { t } = useTranslation();
  const activeId = useProjectsStore((s) => s.activeProjectId);
  const git = useGitStore((s) => (activeId ? s.byProject[activeId] : null));
  const panelOpen = useSourceControlStore((s) => s.open);
  const togglePanel = useSourceControlStore((s) => s.toggle);

  const changeCount = git ? Object.keys(git.statuses).length : 0;

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "relative flex h-[36px] items-center select-none border-b border-hairline bg-canvas",
        isMac ? "pl-[78px] pr-[16px]" : "pl-[14px] pr-[14px]",
        className,
      )}
    >
      <div
        data-tauri-drag-region
        className="flex flex-1 items-center justify-center gap-[12px]"
      >
        <span data-tauri-drag-region className="editorial-caps text-muted">
          metacodex
        </span>
        {workspaceName ? (
          <>
            <span data-tauri-drag-region className="h-[10px] w-px bg-hairline-strong" />
            <span data-tauri-drag-region className="font-mono text-[11px] text-muted">
              {workspaceName}
            </span>
          </>
        ) : null}
        {git && git.branch ? (
          <>
            <span data-tauri-drag-region className="h-[10px] w-px bg-hairline-strong" />
            <span
              data-tauri-drag-region
              className="inline-flex items-center gap-[5px] font-mono text-[11px] text-muted"
            >
              <Icon icon={GitBranch} size={10} strokeWidth={2} />
              <span data-tauri-drag-region className="text-ink">
                {git.branch}
              </span>
              {git.ahead > 0 ? (
                <span data-tauri-drag-region className="inline-flex items-center text-muted-soft">
                  <Icon icon={ArrowUp} size={9} strokeWidth={2} />
                  {git.ahead}
                </span>
              ) : null}
              {git.behind > 0 ? (
                <span data-tauri-drag-region className="inline-flex items-center text-muted-soft">
                  <Icon icon={ArrowDown} size={9} strokeWidth={2} />
                  {git.behind}
                </span>
              ) : null}
            </span>
          </>
        ) : null}
      </div>

      {/* Source Control toggle. Absolutely positioned so it never shifts the
          centred title cluster. No drag-region attribute → clicks land on the
          button rather than starting a window drag. */}
      <Tooltip content={t("sourceControl.toggle")} side="bottom">
        <button
          type="button"
          onClick={togglePanel}
          aria-label={t("sourceControl.toggle")}
          aria-pressed={panelOpen}
          className={cn(
            "absolute right-[10px] top-1/2 -translate-y-1/2 inline-flex h-[24px] items-center gap-[5px] rounded-sm px-[7px]",
            "transition-colors duration-[var(--dur-fast)]",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
            panelOpen
              ? "bg-surface-strong/70 text-ink"
              : "text-muted hover:bg-surface-strong/45 hover:text-body",
          )}
        >
          <Icon icon={PanelRight} size={14} strokeWidth={1.75} />
          {changeCount > 0 ? (
            <span className="font-mono text-[10px] leading-none tabular-nums">
              {changeCount > 99 ? "99+" : changeCount}
            </span>
          ) : null}
        </button>
      </Tooltip>
    </header>
  );
}
