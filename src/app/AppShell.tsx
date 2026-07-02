import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useSourceControlStore } from "@/features/source-control/sourceControl.store";
import type { PreviewGrant } from "@/lib/events";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import { PANEL_LIMITS } from "@/features/settings/settings.types";
import { useTranslation } from "react-i18next";
import { SourceControlPanel } from "@/components/source-control/SourceControlPanel";
import { WorktreeCreateDialog } from "@/components/source-control/WorktreeCreateDialog";
import { CloneFromGithubDialog } from "@/components/project-rail/CloneFromGithubDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { Toaster } from "@/components/ui/Toaster";
import { CloseTabsConfirm } from "@/app/CloseTabsConfirm";
import {
  EMPTY_BUCKET,
  PROJECTS_PANEL_WIDTH_PX,
  RAIL_WIDTH_PX,
  type PendingClose,
} from "@/app/appShell.helpers";
import { registerAppCommands } from "@/app/appCommands";
import { useAppBootstrap } from "@/app/hooks/useAppBootstrap";
import { useFilesystemSync } from "@/app/hooks/useFilesystemSync";
import { useWorkspacePersistence } from "@/app/hooks/useWorkspacePersistence";
import { useTabActions } from "@/app/hooks/useTabActions";

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

  const panelOpen = useSourceControlStore((s) => s.open);
  // Code sidebar collapsed -> the Files/History panel folds away to just the rail.
  const codeSidebarCollapsed = useCodeSidebarStore((s) => s.collapsed);

  // Resizable panel widths, driven by settings, persisted to ~/.metacodex.
  const explorerWidth = useSettingsDataStore((s) => s.settings.panels.explorerWidth);
  const sourceControlWidth = useSettingsDataStore(
    (s) => s.settings.panels.sourceControlWidth,
  );
  const updateSettings = useSettingsDataStore((s) => s.update);
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
  const resetSourceControlWidth = useCallback(
    () => updateSettings("panels", { sourceControlWidth: PANEL_LIMITS.sourceControl.default }),
    [updateSettings],
  );

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
  // The right panel currently hosts Source Control only, see
  // `SourceControlPanel.tsx`.
  // Column 1 is the projects sidebar: the icon rail when collapsed, a wider
  // panel with projects and nested sections when expanded. The file explorer
  // stays its own column at explorerWidth.
  const projectsColWidth = codeSidebarCollapsed ? RAIL_WIDTH_PX : PROJECTS_PANEL_WIDTH_PX;
  const gridTemplateColumns = panelOpen
    ? `${projectsColWidth}px ${explorerWidth}px minmax(0,1fr) ${sourceControlWidth}px`
    : `${projectsColWidth}px ${explorerWidth}px minmax(0,1fr)`;

  return (
    <div
      className="relative grid h-screen w-screen grid-rows-[36px_minmax(0,1fr)] bg-canvas text-ink"
      style={{ gridTemplateColumns }}
    >
      <DropOverlay active={dropActive} />
      <TitleBar
        className="col-span-full"
        onOpenFolder={actions.openFolder}
        onCloneFromGithub={actions.cloneFromGithub}
        onNewTerminal={actions.newTerminal}
        onLaunchCli={actions.launchCli}
        onNewWorktree={project ? actions.openWorktreeDialog : undefined}
      />

      {/* `contents` keeps these as direct grid items while letting this block
          group the core code workspace in JSX. */}
      <div className="contents">
        {codeSidebarCollapsed ? (
          <MiniProjectSidebar />
        ) : (
          <ExpandedProjectsSidebar onOpenFolder={actions.openFolder} />
        )}

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

        {panelOpen ? (
          <div className="relative min-w-0">
            {project ? (
              <SourceControlPanel
                projectId={project.id}
                projectPath={project.path}
                onOpenDiff={actions.openDiff}
              />
            ) : (
              <aside
                className="h-full min-h-0 border-l border-hairline bg-canvas"
                aria-label={t("sourceControl.title")}
              >
                <EmptyState body={t("sourceControl.noProject")} />
              </aside>
            )}
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
              ariaLabel={t("appShell.resizeSourceControl")}
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
