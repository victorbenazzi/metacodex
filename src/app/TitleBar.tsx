import { GitBranch, ArrowUp, ArrowDown } from "lucide-react";

import { cn } from "@/lib/cn";
import { isMac } from "@/lib/platform";
import { useGitStore } from "@/features/git/git.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { Icon } from "@/components/ui/Icon";

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
 * recognized as a drag and the window can't be moved.
 */
export function TitleBar({ workspaceName, className }: TitleBarProps) {
  const activeId = useProjectsStore((s) => s.activeProjectId);
  const git = useGitStore((s) => (activeId ? s.byProject[activeId] : null));

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
    </header>
  );
}
