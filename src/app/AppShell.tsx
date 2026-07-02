import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MiniProjectSidebar } from "@/components/project-rail/MiniProjectSidebar";
import { ExplorerPanel } from "@/components/file-explorer/ExplorerPanel";
import { ExpandedProjectsSidebar } from "@/components/code-sidebar/ExpandedProjectsSidebar";
import { useCodeSidebarStore } from "@/features/ui/codeSidebar.store";
import { WorkArea } from "@/components/tabs/WorkArea";
import { TitleBar } from "@/app/TitleBar";
import {
  useTabsStore,
  WORKSPACE_NULL,
} from "@/components/tabs/tabsStore";
import { SendToProjectDialog } from "@/components/previews/SendToProjectDialog";
import { DropOverlay } from "@/components/previews/DropOverlay";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { useSettingsStore } from "@/features/settings/settings.store";
import type { PreviewGrant } from "@/lib/events";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import { PANEL_LIMITS } from "@/features/settings/settings.types";
import { useTranslation } from "react-i18next";
import { SidePanel } from "@/components/side-panel/SidePanel";
import { useSidePanelStore } from "@/features/side-panel/sidePanel.store";
import { WorktreeCreateDialog } from "@/components/source-control/WorktreeCreateDialog";
import { CloneFromGithubDialog } from "@/components/project-rail/CloneFromGithubDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { Toaster } from "@/components/ui/Toaster";
import { CloseTabsConfirm } from "@/app/CloseTabsConfirm";
import {
  EMPTY_BUCKET,
  RAIL_WIDTH_PX,
  type PendingClose,
} from "@/app/appShell.helpers";
import { registerAppCommands } from "@/app/appCommands";
import { useAppBootstrap } from "@/app/hooks/useAppBootstrap";
import { useFilesystemSync } from "@/app/hooks/useFilesystemSync";
import { useWorkspacePersistence } from "@/app/hooks/useWorkspacePersistence";
import { useTabActions } from "@/app/hooks/useTabActions";
import { cn } from "@/lib/cn";

const DRAWER_ANIMATION_MS = 180;

export function AppShell() {
  const { t } = useTranslation();
  const { homeDirPath } = useAppBootstrap();

  // Projects store
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  // Settings dialog lives here (always mounted) so it opens regardless of which
  // sidebar form is rendered. Driven by the global settings (open/close) store.
  const settingsDialogOpen = useSettingsStore((s) => s.open);
  const setSettingsDialogOpen = useSettingsStore((s) => s.setOpen);

  const project = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  useFilesystemSync(project);

  // Tabs store keyed per project.
  const projectKey = project?.id ?? WORKSPACE_NULL;
  // Subscribe to ALL buckets, TabContent mounts every project's tabs so PTYs
  // and editor buffers survive a project switch (hidden via display:none for
  // anything other than the active project's active tab).
  const allBuckets = useTabsStore((s) => s.byProject);
  const bucket = allBuckets[projectKey] ?? EMPTY_BUCKET;
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  // Preview mode: file being sent to a project (null = dialog closed) + the
  // drag-over feedback flag for the global file-drop target.
  const [sendToProjectFile, setSendToProjectFile] = useState<PreviewGrant | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const activeCwd = useMemo(
    () => project?.path ?? homeDirPath ?? "/",
    [project, homeDirPath],
  );

  const panelOpen = useSidePanelStore((s) => s.open);
  // Code sidebar collapsed -> the Files/History panel folds away to just the rail.
  const codeSidebarCollapsed = useCodeSidebarStore((s) => s.collapsed);
  const [sidePanelMounted, setSidePanelMounted] = useState(panelOpen);
  const [drawerAnimating, setDrawerAnimating] = useState(false);
  const previousDrawerState = useRef({ codeSidebarCollapsed, panelOpen });
  const drawerStateChanged =
    previousDrawerState.current.codeSidebarCollapsed !== codeSidebarCollapsed ||
    previousDrawerState.current.panelOpen !== panelOpen;
  const drawerTransitionActive = drawerStateChanged || drawerAnimating;

  // Resizable panel widths, driven by settings, persisted to ~/.metacodex.
  const projectsWidth = useSettingsDataStore((s) => s.settings.panels.projectsWidth);
  const explorerWidth = useSettingsDataStore((s) => s.settings.panels.explorerWidth);
  const sourceControlWidth = useSettingsDataStore(
    (s) => s.settings.panels.sourceControlWidth,
  );
  const updateSettings = useSettingsDataStore((s) => s.update);
  const handleProjectsWidthChange = useCallback(
    (next: number) => updateSettings("panels", { projectsWidth: Math.round(next) }),
    [updateSettings],
  );
  const handleExplorerWidthChange = useCallback(
    (next: number) => updateSettings("panels", { explorerWidth: Math.round(next) }),
    [updateSettings],
  );
  const handleSourceControlWidthChange = useCallback(
    (next: number) => updateSettings("panels", { sourceControlWidth: Math.round(next) }),
    [updateSettings],
  );
  const resetExplorerWidth = useCallback(
    () => updateSettings("panels", { explorerWidth: PANEL_LIMITS.explorer.default }),
    [updateSettings],
  );
  const resetProjectsWidth = useCallback(
    () => updateSettings("panels", { projectsWidth: PANEL_LIMITS.projects.default }),
    [updateSettings],
  );
  const resetSourceControlWidth = useCallback(
    () => updateSettings("panels", { sourceControlWidth: PANEL_LIMITS.sourceControl.default }),
    [updateSettings],
  );

  useEffect(() => {
    if (panelOpen) {
      setSidePanelMounted(true);
      return undefined;
    }

    const timeout = window.setTimeout(
      () => setSidePanelMounted(false),
      DRAWER_ANIMATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [panelOpen]);

  useEffect(() => {
    previousDrawerState.current = { codeSidebarCollapsed, panelOpen };
    if (!drawerStateChanged) {
      return undefined;
    }

    setDrawerAnimating(true);
    const timeout = window.setTimeout(
      () => setDrawerAnimating(false),
      DRAWER_ANIMATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [codeSidebarCollapsed, panelOpen]);

  useWorkspacePersistence(project, projects, bucket);

  const actions = useTabActions({
    project,
    projects,
    projectKey,
    bucket,
    activeCwd,
    pendingClose,
    setPendingClose,
    setWorktreeDialogOpen,
    setCloneDialogOpen,
    setSendToProjectFile,
    setDropActive,
  });

  useEffect(() => registerAppCommands(actions), [actions]);

  // CSS-grid template: the variable-width columns interpolate the current
  // settings so resizing rerenders only this style + the dragged column.
  // The right panel hosts the Codex-style side panel.
  // Column 1 is the projects sidebar: the icon rail when collapsed, a wider
  // panel with projects and nested sections when expanded. The file explorer
  // stays its own column at explorerWidth.
  const projectsColWidth = codeSidebarCollapsed ? RAIL_WIDTH_PX : projectsWidth;
  const sidePanelColWidth = panelOpen ? sourceControlWidth : 0;
  const gridTemplateColumns = `${projectsColWidth}px ${explorerWidth}px minmax(0,1fr) ${sidePanelColWidth}px`;

  return (
    <div
      className={cn(
        "relative grid h-screen w-screen grid-rows-[36px_minmax(0,1fr)] bg-canvas text-ink",
        drawerTransitionActive &&
          "transition-[grid-template-columns] duration-base ease-out motion-reduce:transition-none",
      )}
      style={{ gridTemplateColumns }}
    >
      <DropOverlay active={dropActive} />
      <TitleBar
        className="col-span-full"
        onOpenFolder={actions.openFolder}
        onCloneFromGithub={actions.cloneFromGithub}
      />

      {/* `contents` keeps these as direct grid items while letting this block
          group the core code workspace in JSX. */}
      <div className="contents">
        <div className="relative min-w-0">
          <div className="absolute inset-0 overflow-hidden">
            <div
              aria-hidden={!codeSidebarCollapsed}
              className={cn(
                "absolute inset-0 transition-[opacity,transform] duration-base ease-out motion-reduce:transition-none",
                codeSidebarCollapsed
                  ? "translate-x-0 opacity-100"
                  : "pointer-events-none -translate-x-[10px] opacity-0",
              )}
            >
              <MiniProjectSidebar />
            </div>
            <div
              aria-hidden={codeSidebarCollapsed}
              className={cn(
                "absolute inset-y-0 left-0 h-full transition-[opacity,transform] duration-base ease-out motion-reduce:transition-none",
                codeSidebarCollapsed
                  ? "pointer-events-none -translate-x-[14px] opacity-0"
                  : "translate-x-0 opacity-100",
              )}
              style={{ width: projectsWidth }}
            >
              <ExpandedProjectsSidebar onOpenFolder={actions.openFolder} />
            </div>
          </div>
          <ResizeHandle
            side="right"
            value={projectsWidth}
            min={PANEL_LIMITS.projects.min}
            max={PANEL_LIMITS.projects.max}
            toDelta={(dx) => dx}
            onChange={handleProjectsWidthChange}
            onReset={resetProjectsWidth}
            ariaLabel={t("appShell.resizeProjectsPanel")}
            enabled={!codeSidebarCollapsed}
          />
        </div>

        <div className="relative min-w-0">
          <ExplorerPanel
            hasProject={!!project}
            projectId={project?.id}
            projectName={project?.name}
            projectPath={project?.path}
            onOpenFolder={actions.openFolder}
            onOpenFile={actions.openFile}
            onOpenInTerminal={actions.openInTerminal}
            onLaunchCliInPath={actions.launchCliInPath}
          />
          <ResizeHandle
            side="right"
            value={explorerWidth}
            min={PANEL_LIMITS.explorer.min}
            max={PANEL_LIMITS.explorer.max}
            toDelta={(dx) => dx}
            onChange={handleExplorerWidthChange}
            onReset={resetExplorerWidth}
            ariaLabel={t("appShell.resizeExplorer")}
          />
        </div>

        <WorkArea
          project={project}
          tabs={bucket.tabs}
          activeTabId={bucket.activeTabId}
          allBuckets={allBuckets}
          activeProjectKey={projectKey}
          onSelectTab={actions.selectTab}
          onCloseTab={actions.closeTab}
          onCloseOthers={actions.closeOthers}
          onCloseAll={actions.closeAll}
          onCopyTabPath={actions.copyTabPath}
          onRevealTabInFinder={actions.revealTabInFinder}
          onCopyTabCwd={actions.copyTabCwd}
          onRenameTab={actions.renameTab}
          onMoveTab={actions.moveTab}
          onNewTerminal={actions.newTerminal}
          onLaunchCli={actions.launchCli}
          onOpenFolder={actions.openFolder}
          onCloneFromGithub={actions.cloneFromGithub}
          onOpenPreviewFile={actions.pickPreviewFile}
        />

        {panelOpen || sidePanelMounted ? (
          <div className="relative min-w-0">
            <div
              aria-hidden={!panelOpen}
              className="absolute inset-0 overflow-hidden"
            >
              <div
                className={cn(
                  "absolute inset-y-0 right-0 h-full transition-[opacity,transform] duration-base ease-out motion-reduce:transition-none",
                  panelOpen
                    ? "translate-x-0 opacity-100"
                    : "pointer-events-none translate-x-[16px] opacity-0",
                )}
                style={{ width: sourceControlWidth }}
              >
                <SidePanel
                  project={project}
                  onNewTerminal={actions.newTerminal}
                  onLaunchCli={actions.launchCli}
                  onOpenDiff={actions.openDiff}
                />
              </div>
            </div>
            <ResizeHandle
              side="left"
              value={sourceControlWidth}
              min={PANEL_LIMITS.sourceControl.min}
              max={PANEL_LIMITS.sourceControl.max}
              // Panel sits on the right edge of the window: dragging RIGHT
              // shrinks it, dragging LEFT grows it. Invert the pointer delta.
              toDelta={(dx) => -dx}
              onChange={handleSourceControlWidthChange}
              onReset={resetSourceControlWidth}
              ariaLabel={t("appShell.resizeSidePanel")}
              enabled={panelOpen}
            />
          </div>
        ) : null}
      </div>

      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />

      <CloseTabsConfirm
        state={pendingClose}
        onCancel={() => setPendingClose(null)}
        onConfirm={actions.confirmPendingClose}
      />

      {project ? (
        <WorktreeCreateDialog
          open={worktreeDialogOpen}
          onOpenChange={setWorktreeDialogOpen}
          projectId={project.id}
          projectPath={project.path}
          defaultBranchName=""
          defaultCliId={null}
          onAfterCreate={actions.afterWorktreeCreate}
        />
      ) : null}

      <CloneFromGithubDialog
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
      />

      <SendToProjectDialog
        file={sendToProjectFile}
        onOpenChange={(o) => {
          if (!o) setSendToProjectFile(null);
        }}
        onSent={actions.sentToProject}
      />
      <Toaster />
    </div>
  );
}
