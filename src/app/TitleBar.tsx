import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GitBranch,
  ArrowUp,
  ArrowDown,
  FolderPlus,
  FolderOpen,
  Github,
  Server,
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
import { SidePanelToggle } from "@/components/side-panel/SidePanelToggle";
import { ProjectGlyph } from "@/components/project-rail/ProjectGlyph";
import { UpdatePill } from "@/components/updates/UpdatePill";

interface TitleBarProps {
  className?: string;
  /** Sidebar collapse + add-project sit on the leading edge. */
  onOpenFolder?: () => void;
  onCloneFromGithub?: () => void;
  onConnectSsh?: () => void;
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
  className,
  onOpenFolder,
  onCloneFromGithub,
  onConnectSsh,
}: TitleBarProps) {
  const { t } = useTranslation();
  const activeId = useProjectsStore((s) => s.activeProjectId);
  const activeProject = useProjectsStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null,
  );
  const git = useGitStore((s) => (activeId ? s.byProject[activeId] : null));
  const codeCollapsed = useCodeSidebarStore((s) => s.collapsed);
  const toggleCodeSidebar = useCodeSidebarStore((s) => s.toggleCollapsed);

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "relative grid h-[var(--title-bar-h)] grid-cols-[1fr_auto_1fr] items-center select-none bg-canvas",
        // macOS: traffic lights sit at x=16 (tauri.conf.json) and the green
        // light ends around 82px; 94px keeps a 12px gap between the lights
        // and the first control.
        isMac
          ? "pl-[94px] pr-[16px]"
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
              <Icon icon={codeCollapsed ? PanelLeftOpen : PanelLeftClose} size={14} />
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
                  <Icon icon={FolderPlus} size={14} />
                </button>
              </DropdownTrigger>
            </Tooltip>
            <DropdownContent align="start" sideOffset={6}>
              <DropdownItem onSelect={() => onOpenFolder?.()} trailing={<Kbd keys={["Mod", "O"]} />}>
                <Icon icon={FolderOpen} size={12} className="text-muted" />
                {t("welcome.openProjectMenu.local")}
              </DropdownItem>
              <DropdownItem
                onSelect={() => onCloneFromGithub?.()}
                trailing={<Kbd keys={["Mod", "Shift", "O"]} />}
              >
                <Icon icon={Github} size={12} className="text-muted" />
                {t("welcome.openProjectMenu.github")}
              </DropdownItem>
              <DropdownItem onSelect={() => onConnectSsh?.()}>
                <Icon icon={Server} size={12} className="text-muted" />
                {t("welcome.openProjectMenu.ssh")}
              </DropdownItem>
            </DropdownContent>
          </DropdownRoot>
        </div>
      </div>

      <div
        data-tauri-drag-region
        className="flex items-center justify-self-center gap-[12px]"
      >
        {activeProject ? (
          <span
            data-tauri-drag-region
            className="inline-flex items-center gap-[6px] font-mono text-label text-ink"
            title={activeProject.path}
          >
            {/* pointer-events:none keeps mousedown on the glyph hitting the
                drag-region span, so the window still drags from here. */}
            <span data-tauri-drag-region className="pointer-events-none inline-flex">
              <ProjectGlyph project={activeProject} size={12} />
            </span>
            {activeProject.name}
          </span>
        ) : null}
        {activeProject && git && git.branch ? (
          <span data-tauri-drag-region className="h-[10px] w-px bg-hairline-strong" />
        ) : null}
        {git && git.branch ? (
          <span
            data-tauri-drag-region
            className="inline-flex items-center gap-[5px] font-mono text-label text-muted"
          >
            <Icon icon={GitBranch} size={10} />
            <span data-tauri-drag-region className="text-ink">
              {git.branch}
            </span>
            {git.ahead > 0 ? (
              <span data-tauri-drag-region className="inline-flex items-center text-muted-soft">
                <Icon icon={ArrowUp} size={10} />
                {git.ahead}
              </span>
            ) : null}
            {git.behind > 0 ? (
              <span data-tauri-drag-region className="inline-flex items-center text-muted-soft">
                <Icon icon={ArrowDown} size={10} />
                {git.behind}
              </span>
            ) : null}
          </span>
        ) : null}
        <UpdatePill />
      </div>

      {/* Right slot: side panel toggle. */}
      <div className="flex items-center gap-[6px] justify-self-end">
        <SidePanelToggle />
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
  const { t } = useTranslation();
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
    <div className="absolute right-0 top-0 flex h-[var(--title-bar-h)]">
      <ControlButton
        onClick={minimize}
        title={t("titleBar.minimize")}
        ariaLabel={t("titleBar.minimize")}
      >
        <Icon icon={Minus} size={12} />
      </ControlButton>
      <ControlButton
        onClick={toggleMax}
        title={maximized ? t("titleBar.restore") : t("titleBar.maximize")}
        ariaLabel={maximized ? t("titleBar.restore") : t("titleBar.maximize")}
      >
        <Icon icon={maximized ? Copy : Square} size={12} />
      </ControlButton>
      <ControlButton onClick={close} title={t("titleBar.close")} ariaLabel={t("titleBar.close")} danger>
        <Icon icon={X} size={12} />
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
        "inline-flex h-[var(--title-bar-h)] w-[46px] items-center justify-center text-muted transition-colors",
        danger
          ? "hover:bg-win-close hover:text-white"
          : "hover:bg-surface-strong/55 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
