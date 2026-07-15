import { useCallback, useEffect, useMemo, useState } from "react";
import { MiniProjectSidebar } from "@/components/project-rail/MiniProjectSidebar";
import { ExplorerPanel } from "@/components/file-explorer/ExplorerPanel";
import { ExplorerTogglePill } from "@/components/file-explorer/ExplorerTogglePill";
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
import { isRemoteProject } from "@/features/projects/project.types";
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
import { RemoteAccessDialog } from "@/components/project-rail/RemoteAccessDialog";
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
import { useDelayedFlag } from "@/app/hooks/useDelayedFlag";
import { cn } from "@/lib/cn";

// Must equal `--dur-drawer` (tokens.css): the side panel must stay mounted until
// its grid track finishes closing.
const DRAWER_ANIMATION_MS = 240;
// Horizontal gap between the floating sidebar cards, as a CSS value so it stays
// in lockstep with the resize-handle offsets and the vertical insets. Source of
// truth: `--panel-gap-x` in tokens.css. The vertical gaps use `--panel-gap-y`.
const PANEL_GAP_X = "var(--panel-gap-x)";

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
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  // Preview mode: file being sent to a project (null = dialog closed) + the
  // drag-over feedback flag for the global file-drop target.
  const [sendToProjectFile, setSendToProjectFile] = useState<PreviewGrant | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const activeCwd = useMemo(
    () => project?.path ?? homeDirPath ?? "/",
    [project, homeDirPath],
  );

  const panelOpen = useSidePanelStore((s) => s.view !== "closed");
  // Code sidebar collapsed -> the Files/History panel folds away to just the rail.
  const codeSidebarCollapsed = useCodeSidebarStore((s) => s.collapsed);
  // Explorer collapsed -> the file-explorer column folds to zero width; the
  // toggle pill on the seam is the way back.
  const explorerCollapsed = useCodeSidebarStore((s) => s.explorerCollapsed);
  const toggleExplorerCollapsed = useCodeSidebarStore((s) => s.toggleExplorerCollapsed);
  // Keep the side panel mounted through its close animation.
  const sidePanelMounted = useDelayedFlag(panelOpen, DRAWER_ANIMATION_MS);
  // Suspend grid easing while a resize handle is active so width changes track
  // the pointer directly instead of trailing behind it.
  const [resizing, setResizing] = useState(false);

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

  // CSS-grid template: drawer toggles interpolate the panel and adjacent gap
  // tracks together. Pointer resizing bypasses the transition.
  // Floating-panel layout: the sidebars (projects, explorer, side panel) are
  // rounded cards separated from the window edges and from each other by
  // fixed gap COLUMNS baked into the template. Gaps adjacent to a collapsed
  // panel collapse to 0 with it. The work area stays flush with the window.
  const projectsColWidth = codeSidebarCollapsed ? RAIL_WIDTH_PX : projectsWidth;
  const explorerColWidth = explorerCollapsed ? 0 : explorerWidth;
  const explorerGap = explorerCollapsed ? "0px" : PANEL_GAP_X;
  const sidePanelColWidth = panelOpen ? sourceControlWidth : 0;
  const sidePanelGap = panelOpen ? PANEL_GAP_X : "0px";
  const gridTemplateColumns =
    `${PANEL_GAP_X} ${projectsColWidth}px ${PANEL_GAP_X} ` +
    `${explorerColWidth}px ${explorerGap} minmax(0,1fr) ` +
    `${sidePanelGap} ${sidePanelColWidth}px ${sidePanelGap}`;

  return (
    <div
      className={cn(
        "relative grid h-screen w-screen grid-rows-[var(--title-bar-h)_minmax(0,1fr)] bg-canvas text-ink",
        !resizing &&
          "transition-[grid-template-columns] duration-drawer ease-drawer motion-reduce:transition-none",
      )}
      style={{ gridTemplateColumns }}
    >
      <DropOverlay active={dropActive} />
      <TitleBar
        className="col-span-full"
        onOpenFolder={actions.openFolder}
        onCloneFromGithub={actions.cloneFromGithub}
        onConnectSsh={() => setRemoteDialogOpen(true)}
      />

      {/* `contents` keeps these as direct grid items while letting this block
          group the core code workspace in JSX. The empty divs are the gap
          columns of the floating-panel template: auto-placement needs a child
          per column to land each panel in the right slot. */}
      <div className="contents">
        <div aria-hidden />
        <div className="relative min-w-0">
          {/* The vertical gap lives on the clip container: absolute children
              resolve against the padding box, so padding on the wrapper would
              not inset them. */}
          <div className="absolute inset-x-0 bottom-[var(--panel-gap-y)] top-[var(--panel-gap-y)] overflow-hidden">
            <div
              aria-hidden={!codeSidebarCollapsed}
              className={cn(
                "absolute inset-y-0 left-0 w-[var(--rail-w)] transition-opacity duration-drawer ease-drawer",
                codeSidebarCollapsed
                  ? "opacity-100"
                  : "pointer-events-none opacity-0",
              )}
            >
              <MiniProjectSidebar />
            </div>
            <div
              aria-hidden={codeSidebarCollapsed}
              className={cn(
                "absolute inset-y-0 left-0 h-full transition-opacity duration-drawer ease-drawer",
                codeSidebarCollapsed
                  ? "pointer-events-none opacity-0"
                  : "opacity-100",
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
            onDraggingChange={setResizing}
            className="bottom-[var(--panel-gap-y)] top-[var(--panel-gap-y)] h-auto"
          />
        </div>

        <div aria-hidden />
        <div className="group/explorer relative min-w-0">
          {/* Same drawer recipe as the projects sidebar / side panel: the
              content keeps its full width inside an overflow-hidden clip so
              the grid column can slide to zero without reflowing the tree. */}
          <div
            aria-hidden={explorerCollapsed}
            className="absolute inset-x-0 bottom-[var(--panel-gap-y)] top-[var(--panel-gap-y)] overflow-hidden"
          >
            <div
              className={cn(
                "absolute inset-y-0 left-0 h-full transition-opacity duration-drawer ease-drawer",
                explorerCollapsed
                  ? "pointer-events-none opacity-0"
                  : "opacity-100",
              )}
              style={{ width: explorerWidth }}
            >
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
            </div>
          </div>
          <ResizeHandle
            side="right"
            value={explorerWidth}
            min={PANEL_LIMITS.explorer.min}
            max={PANEL_LIMITS.explorer.max}
            toDelta={(dx) => dx}
            onChange={handleExplorerWidthChange}
            onReset={resetExplorerWidth}
            ariaLabel={t("appShell.resizeExplorer")}
            enabled={!explorerCollapsed}
            onDraggingChange={setResizing}
            className="bottom-[var(--panel-gap-y)] top-[var(--panel-gap-y)] h-auto"
          >
            <ExplorerTogglePill collapsed={false} onToggle={toggleExplorerCollapsed} />
          </ResizeHandle>
          {explorerCollapsed ? (
            // The handle is gone while collapsed; park the pill straddling the
            // projects card's trailing edge. This column is 0px wide and sits
            // after one gap, so offsetting by TWO gaps (and spanning two) centers
            // the pill on that edge. The wrapper is inert; only the pill takes
            // pointer events.
            <div
              className="pointer-events-none absolute top-0 z-30 h-full"
              style={{
                left: "calc(var(--panel-gap-x) * -2)",
                width: "calc(var(--panel-gap-x) * 2)",
              }}
            >
              <ExplorerTogglePill collapsed onToggle={toggleExplorerCollapsed} />
            </div>
          ) : null}
        </div>

        <div aria-hidden />
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

        <div aria-hidden />
        {/* The wrapper stays mounted even while the panel is closed so grid
            auto-placement keeps every sibling in its template column. */}
        <div className="relative min-w-0">
          {panelOpen || sidePanelMounted ? (
            <>
              <div
                aria-hidden={!panelOpen}
                className="absolute inset-x-0 bottom-[var(--panel-gap-y)] top-[var(--panel-gap-y)] overflow-hidden"
              >
                <div
                  className={cn(
                    "absolute inset-y-0 right-0 h-full transition-opacity duration-drawer ease-drawer",
                    panelOpen
                      ? "opacity-100"
                      : "pointer-events-none opacity-0",
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
                onDraggingChange={setResizing}
                className="bottom-[var(--panel-gap-y)] top-[var(--panel-gap-y)] h-auto"
              />
            </>
          ) : null}
        </div>
      </div>

      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />

      <CloseTabsConfirm
        state={pendingClose}
        onCancel={() => setPendingClose(null)}
        onConfirm={actions.confirmPendingClose}
      />

      {project && !isRemoteProject(project) ? (
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

      <RemoteAccessDialog
        open={remoteDialogOpen}
        onOpenChange={setRemoteDialogOpen}
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
