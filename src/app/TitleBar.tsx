import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, ArrowUp, ArrowDown, Sparkles, Code2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { isMac } from "@/lib/platform";
import { useGitStore } from "@/features/git/git.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { useViewStore } from "@/features/ui/view.store";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { useSaveStatusStore } from "@/features/workspace/saveStatus.store";
import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";
import { UpdatePill } from "@/components/updates/UpdatePill";

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
  const { t } = useTranslation();
  const activeId = useProjectsStore((s) => s.activeProjectId);
  const git = useGitStore((s) => (activeId ? s.byProject[activeId] : null));
  const view = useViewStore((s) => s.view);
  const setView = useViewStore((s) => s.setView);

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "relative grid h-[36px] grid-cols-[1fr_auto_1fr] items-center select-none border-b border-hairline bg-canvas",
        isMac ? "pl-[78px] pr-[16px]" : "pl-[14px] pr-[14px]",
        className,
      )}
    >
      {/* Top-level view switch — sits where the wordmark used to, just past the
          macOS traffic lights. NOT a drag region (it's an interactive control);
          the rest of the header still drags the window. */}
      <div className="justify-self-start">
        <Segmented
          size="sm"
          ariaLabel={t("agent.viewToggle.label")}
          value={view}
          onChange={setView}
          options={[
            { value: "agent", label: t("agent.viewToggle.agent"), icon: Sparkles },
            { value: "code", label: t("agent.viewToggle.code"), icon: Code2 },
          ]}
        />
      </div>

      <div
        data-tauri-drag-region
        className="flex items-center justify-self-center gap-[12px]"
      >
        {/* Project + branch are redundant in Agent mode (shown under the
            composer), so the topbar only carries them in Code view. */}
        {view !== "agent" && workspaceName ? (
          <span data-tauri-drag-region className="font-mono text-[11px] text-ink">
            {workspaceName}
          </span>
        ) : null}
        {view !== "agent" && workspaceName && git && git.branch ? (
          <span data-tauri-drag-region className="h-[10px] w-px bg-hairline-strong" />
        ) : null}
        {view !== "agent" && git && git.branch ? (
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
        ) : null}
        <UpdatePill />
      </div>

      {/* Right slot: workspace save-status dot (saving / saved / failed). The
          centered grid column stays balanced because the dot is tiny and the
          slot is reserved either way. */}
      <SaveStatusDot />
    </header>
  );
}

/** 6px dot tracking the workspace save lifecycle. Green fades after 2s of
 *  inactivity so it doesn't linger. Red is clickable → opens the diagnostic
 *  log filtered to workspace events for quick debugging. */
function SaveStatusDot() {
  const status = useSaveStatusStore((s) => s.status);
  const lastSavedAt = useSaveStatusStore((s) => s.lastSavedAt);
  const setDiagOpen = useDiagnosticsStore((s) => s.setOpen);
  const setKindFilter = useDiagnosticsStore((s) => s.setKindFilter);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (status !== "saved") {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const handle = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(handle);
  }, [status, lastSavedAt]);

  let color: string | null = null;
  let title = "";
  if (status === "saving") {
    color = "bg-[var(--warn)]";
    title = "Saving workspace…";
  } else if (status === "failed") {
    color = "bg-[var(--danger)]";
    title = "Workspace save failed";
  } else if (status === "saved" && showSaved) {
    color = "bg-[var(--success)]";
    title = "Workspace saved";
  }

  const handleClick = () => {
    if (status !== "failed") return;
    setKindFilter("workspace.save");
    setDiagOpen(true);
  };

  if (!color) {
    return <span data-tauri-drag-region className="justify-self-end" />;
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      className={cn(
        "justify-self-end inline-flex h-[14px] w-[14px] items-center justify-center rounded-full transition-opacity duration-200",
        status === "failed" ? "cursor-pointer" : "cursor-default",
      )}
    >
      <span className={cn("inline-block h-[6px] w-[6px] rounded-full", color)} />
    </button>
  );
}
