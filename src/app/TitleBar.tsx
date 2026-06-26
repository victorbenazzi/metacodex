import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GitBranch,
  ArrowUp,
  ArrowDown,
  FolderPlus,
  FolderOpen,
  Github,
  PanelLeftClose,
  PanelLeftOpen,
  Minus,
  Square,
  Copy,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { cn } from "@/lib/cn";
import { isMac, isWindows } from "@/lib/platform";
import { useGitStore } from "@/features/git/git.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { useCodeSidebarStore } from "@/features/ui/codeSidebar.store";
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { TabTrailingActions } from "@/components/tabs/TabTrailingActions";
import type { CliTool } from "@/features/terminal/cli-registry";
import { useSaveStatusStore } from "@/features/workspace/saveStatus.store";
import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";
import { UpdatePill } from "@/components/updates/UpdatePill";

interface TitleBarProps {
  workspaceName?: string;
  className?: string;
  /** Sidebar collapse + add-project sit on the leading edge. */
  onOpenFolder?: () => void;
  onCloneFromGithub?: () => void;
  /** New-tab + Source Control toggle, moved up to the right slot. */
  onNewTerminal?: () => void;
  onLaunchCli?: (cli: CliTool) => void;
  onNewWorktree?: () => void;
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
export function TitleBar({
  workspaceName,
  className,
  onOpenFolder,
  onCloneFromGithub,
  onNewTerminal,
  onLaunchCli,
  onNewWorktree,
}: TitleBarProps) {
  const { t } = useTranslation();
  const activeId = useProjectsStore((s) => s.activeProjectId);
  const git = useGitStore((s) => (activeId ? s.byProject[activeId] : null));
  const codeCollapsed = useCodeSidebarStore((s) => s.collapsed);
  const toggleCodeSidebar = useCodeSidebarStore((s) => s.toggleCollapsed);

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
      {/* Workspace controls sit where the wordmark used to, just past the macOS
          traffic lights. Interactive controls opt out of the drag region; the
          rest of the header still drags the window. */}
      <div className="flex items-center gap-[8px] justify-self-start">
        <div className="flex items-center gap-[2px]">
          <Tooltip
            content={codeCollapsed ? t("codeSidebar.expand") : t("codeSidebar.collapse")}
            side="bottom"
            align="start"
          >
            <button
              type="button"
              onClick={toggleCodeSidebar}
              aria-label={codeCollapsed ? t("codeSidebar.expand") : t("codeSidebar.collapse")}
              aria-pressed={!codeCollapsed}
              className={cn(
                "inline-flex h-[24px] w-[24px] items-center justify-center rounded-sm text-muted transition-colors",
                "hover:bg-surface-strong/55 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
              )}
            >
              <Icon icon={codeCollapsed ? PanelLeftOpen : PanelLeftClose} size={15} />
            </button>
          </Tooltip>
          <DropdownRoot>
            <Tooltip content={t("projectRail.addProject")} side="bottom">
              <DropdownTrigger asChild>
                <button
                  type="button"
                  aria-label={t("projectRail.addProject")}
                  className={cn(
                    "inline-flex h-[24px] w-[24px] items-center justify-center rounded-sm text-muted transition-colors",
                    "hover:bg-surface-strong/55 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
                    "data-[state=open]:bg-surface-strong/55 data-[state=open]:text-ink",
                  )}
                >
                  <Icon icon={FolderPlus} size={15} />
                </button>
              </DropdownTrigger>
            </Tooltip>
            <DropdownContent align="start" sideOffset={6}>
              <DropdownItem onSelect={() => onOpenFolder?.()} trailing={<Kbd keys={["Mod", "O"]} />}>
                <Icon icon={FolderOpen} size={13} className="text-muted" />
                {t("welcome.openProjectMenu.local")}
              </DropdownItem>
              <DropdownItem
                onSelect={() => onCloneFromGithub?.()}
                trailing={<Kbd keys={["Mod", "Shift", "O"]} />}
              >
                <Icon icon={Github} size={13} className="text-muted" />
                {t("welcome.openProjectMenu.github")}
              </DropdownItem>
            </DropdownContent>
          </DropdownRoot>
        </div>
      </div>

      <div
        data-tauri-drag-region
        className="flex items-center justify-self-center gap-[12px]"
      >
        {workspaceName ? (
          <span data-tauri-drag-region className="font-mono text-label text-ink">
            {workspaceName}
          </span>
        ) : null}
        {workspaceName && git && git.branch ? (
          <span data-tauri-drag-region className="h-[10px] w-px bg-hairline-strong" />
        ) : null}
        {git && git.branch ? (
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

      {/* Right slot: new-tab actions, then the workspace save-status dot. */}
      <div className="flex items-center gap-[6px] justify-self-end">
        {activeId && onNewTerminal && onLaunchCli ? (
          <TabTrailingActions
            onNewTerminal={onNewTerminal}
            onLaunchCli={onLaunchCli}
            onNewWorktree={onNewWorktree}
          />
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
