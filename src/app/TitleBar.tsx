import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GitBranch,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Code2,
  FolderTree,
  Minus,
  Square,
  Copy,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { cn } from "@/lib/cn";
import { isMac, isWindows } from "@/lib/platform";
import { useAgentOverlayPanelsStore } from "@/features/agent/overlayPanels.store";
import { useAgentSessionsStore } from "@/features/agent/sessions.store";
import { useGitStore } from "@/features/git/git.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { useViewStore } from "@/features/ui/view.store";
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { Segmented } from "@/components/ui/Segmented";
import { Tooltip } from "@/components/ui/Tooltip";
import { useSaveStatusStore } from "@/features/workspace/saveStatus.store";
import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";
import { UpdatePill } from "@/components/updates/UpdatePill";

interface TitleBarProps {
  workspaceName?: string;
  className?: string;
}

/**
 * Top drag region.
 *
 * - **macOS**: Overlay titleBarStyle means traffic lights are inset at
 *   top-left, we leave 78px of padding to keep them from overlapping app chrome.
 * - **Windows**: native decorations are disabled (see `tauri.windows.conf.json`),
 *   so we render our own minimize / toggle-maximize / close buttons on the
 *   trailing edge. Reserve ~138px of right padding to clear them.
 * - **Linux**: default decorations remain; same padding as Windows for the
 *   right slot (no custom buttons rendered, just symmetric spacing).
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
  const agentBusy = useAgentSessionsStore((s) => Object.keys(s.runningById).length > 0);
  const explorerOpen = useAgentOverlayPanelsStore((s) => s.explorerOpen);
  const gitOpen = useAgentOverlayPanelsStore((s) => s.gitOpen);
  const toggleExplorer = useAgentOverlayPanelsStore((s) => s.toggleExplorer);
  const toggleGit = useAgentOverlayPanelsStore((s) => s.toggleGit);
  const changeCount = git ? Object.keys(git.statuses).length : 0;

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "relative grid h-[36px] grid-cols-[1fr_auto_1fr] items-center select-none border-b border-hairline bg-canvas",
        isMac
          ? "pl-[78px] pr-[16px]"
          : isWindows
            ? "pl-[14px] pr-[138px]"
            : "pl-[14px] pr-[14px]",
        className,
      )}
    >
      {/* Top-level view switch, sits where the wordmark used to, just past the
          macOS traffic lights. NOT a drag region (it's an interactive control);
          the rest of the header still drags the window. */}
      <div className="justify-self-start">
        {/* Pill treatment (sliding thumb) marks this as the app's top-level
            mode switch, one notch above in-page segmented controls. The plain
            span wrapper exists because Radix's asChild trigger needs a host
            that spreads props, which Segmented intentionally doesn't. */}
        <Tooltip
          content={t("agent.viewToggle.label")}
          shortcut={<Kbd keys={["Mod", "E"]} />}
          side="bottom"
          align="start"
        >
          <span className="inline-flex">
            <Segmented
              size="sm"
              variant="pill"
              ariaLabel={t("agent.viewToggle.label")}
              value={view}
              onChange={setView}
              options={[
                {
                  value: "agent",
                  label: t("agent.viewToggle.agent"),
                  icon: Sparkles,
                  dot: view === "code" && agentBusy,
                  dotLabel: t("agent.viewToggle.agentWorking"),
                },
                { value: "code", label: t("agent.viewToggle.code"), icon: Code2 },
              ]}
            />
          </span>
        </Tooltip>
      </div>

      <div
        data-tauri-drag-region
        className="flex items-center justify-self-center gap-[12px]"
      >
        {/* Project + branch are redundant in Agent mode (shown under the
            composer), so the topbar only carries them in Code view. */}
        {view !== "agent" && workspaceName ? (
          <span data-tauri-drag-region className="font-mono text-label text-ink">
            {workspaceName}
          </span>
        ) : null}
        {view !== "agent" && workspaceName && git && git.branch ? (
          <span data-tauri-drag-region className="h-[10px] w-px bg-hairline-strong" />
        ) : null}
        {view !== "agent" && git && git.branch ? (
          <span
            data-tauri-drag-region
            className="inline-flex items-center gap-[5px] font-mono text-label text-muted"
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

      {/* Right slot: in Agent view, ports of the Code panels (file tree drawer
          + Source Control drawer) as separate toggles, then the workspace
          save-status dot. In Code view both already live in the workspace
          chrome (sidebar / tab bar), so only the dot remains. */}
      <div className="flex items-center gap-[6px] justify-self-end">
        {view === "agent" && activeId ? (
          <>
            <PanelToggle
              icon={FolderTree}
              label={t("explorer.title")}
              pressed={explorerOpen}
              onClick={toggleExplorer}
            />
            <PanelToggle
              icon={GitBranch}
              label={t("sourceControl.toggle")}
              pressed={gitOpen}
              onClick={toggleGit}
              badge={changeCount > 0 ? (changeCount > 99 ? "99+" : String(changeCount)) : undefined}
            />
          </>
        ) : null}
        <SaveStatusDot />
      </div>

      {/* Windows custom window controls: absolutely positioned on the trailing
          edge so they live outside the centered grid and don't shift the
          brand/workspace columns. Rendered only on Windows where we drop the
          native title bar; macOS keeps Apple's traffic lights and Linux keeps
          its DE's decorations. */}
      {isWindows ? <WindowsControls /> : null}
    </header>
  );
}

/** Title-bar toggle for an Agent-view inspect drawer. Same visual language as
 *  the tab bar's Source Control toggle: hairline chip, pressed state lifts
 *  onto surface-strong, optional mono change-count badge. */
function PanelToggle({
  icon,
  label,
  pressed,
  onClick,
  badge,
}: {
  icon: LucideIcon;
  label: string;
  pressed: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <Tooltip content={label} side="bottom" align="end">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        className={cn(
          "inline-flex h-[24px] items-center gap-[5px] rounded-sm border border-hairline px-[7px] font-mono text-[10px] leading-none tabular-nums",
          "transition-colors duration-fast",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
          pressed
            ? "bg-surface-strong/70 text-ink"
            : "bg-canvas/70 text-muted hover:bg-surface-strong/45 hover:text-body",
        )}
      >
        <Icon icon={icon} size={12} strokeWidth={1.75} />
        {badge ? <span>{badge}</span> : null}
      </button>
    </Tooltip>
  );
}

/**
 * Min / toggle-maximize / close stack for Windows. Buttons are 46x36px each
 * to mirror the native sizing convention. Hover background lifts toward the
 * surface tone, except the close button which goes Microsoft-red on hover so
 * the destructive action is unmistakable.
 */
function WindowsControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized).catch(() => undefined);
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized).catch(() => undefined);
      })
      .then((off) => {
        unlisten = off;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  const minimize = () => {
    void getCurrentWindow().minimize().catch(() => undefined);
  };
  const toggleMax = () => {
    void getCurrentWindow().toggleMaximize().catch(() => undefined);
  };
  const close = () => {
    void getCurrentWindow().close().catch(() => undefined);
  };

  return (
    <div className="absolute right-0 top-0 flex h-[36px]">
      <ControlButton onClick={minimize} title="Minimize" ariaLabel="Minimize window">
        <Icon icon={Minus} size={12} strokeWidth={1.6} />
      </ControlButton>
      <ControlButton
        onClick={toggleMax}
        title={maximized ? "Restore" : "Maximize"}
        ariaLabel={maximized ? "Restore window" : "Maximize window"}
      >
        <Icon icon={maximized ? Copy : Square} size={11} strokeWidth={1.6} />
      </ControlButton>
      <ControlButton onClick={close} title="Close" ariaLabel="Close window" danger>
        <Icon icon={X} size={13} strokeWidth={1.6} />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  onClick,
  title,
  ariaLabel,
  danger,
  children,
}: {
  onClick: () => void;
  title: string;
  ariaLabel: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-[36px] w-[46px] items-center justify-center text-muted transition-colors",
        danger
          ? "hover:bg-[#E81123] hover:text-white"
          : "hover:bg-surface-strong/55 hover:text-ink",
      )}
    >
      {children}
    </button>
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
        "justify-self-end inline-flex h-[14px] w-[14px] items-center justify-center rounded-pill transition-opacity duration-base",
        status === "failed" ? "cursor-pointer" : "cursor-default",
      )}
    >
      <span className={cn("inline-block h-[6px] w-[6px] rounded-pill", color)} />
    </button>
  );
}
