import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkArea } from "@/components/tabs/WorkArea";
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
import { RightWorkbench } from "@/components/v3-shell/RightWorkbench";
import { AgentSidebar } from "@/components/v3-shell/AgentSidebar";
import { CenterChrome } from "@/components/v3-shell/CenterChrome";
import { ShellToggles } from "@/components/v3-shell/ShellToggles";
import { WindowsControls } from "@/components/v3-shell/WindowsControls";
import { NewAgentModal } from "@/components/v3-shell/NewAgentModal";
import { OpenProjectModal } from "@/components/v3-shell/OpenProjectModal";
import { useSidePanelStore } from "@/features/side-panel/sidePanel.store";
import { useBrowserUiStore } from "@/features/browser/browser.store";
import { resolveWorkbenchLayout } from "@/features/browser/workbenchLayout";
import { useOverlayLockStore } from "@/features/ui/overlayLock.store";
import { useCodeSidebarStore } from "@/features/ui/codeSidebar.store";
import { WorktreeCreateDialog } from "@/components/source-control/WorktreeCreateDialog";
import { CloneFromGithubDialog } from "@/components/project-rail/CloneFromGithubDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { Toaster } from "@/components/ui/Toaster";
import { WhatsNewDialog } from "@/components/whats-new/WhatsNewDialog";
import { CloseTabsConfirm } from "@/app/CloseTabsConfirm";
import { EMPTY_BUCKET } from "@/app/appShell.helpers";
import { registerAppCommands } from "@/app/appCommands";
import { useAppBootstrap } from "@/app/hooks/useAppBootstrap";
import { useFilesystemSync } from "@/app/hooks/useFilesystemSync";
import { useWorkspacePersistence } from "@/app/hooks/useWorkspacePersistence";
import { useQuitCoordinator } from "@/app/hooks/useQuitCoordinator";
import { QuitBlockedDialog } from "@/components/quit/QuitBlockedDialog";
import { useTabActions } from "@/app/hooks/useTabActions";
import { useDelayedFlag } from "@/app/hooks/useDelayedFlag";
import { useActiveProcessTab } from "@/features/tabs/useActiveProcessTab";
import { isWorkbenchDocTab } from "@/features/tabs";
import {
  cancelPendingClose,
  confirmPendingClose,
  usePendingCloseStore,
} from "@/features/tabs";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

const DRAWER_ANIMATION_MS = 240;
const CENTER_FLOOR = 280;
const CENTER_FLOOR_BROWSER = 72;

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export function AppShell() {
  const { t } = useTranslation();
  const bootstrap = useAppBootstrap();
  const { homeDirPath } = bootstrap;
  const quit = useQuitCoordinator();

  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const settingsDialogOpen = useSettingsStore((s) => s.open);
  const setSettingsDialogOpen = useSettingsStore((s) => s.setOpen);

  const project = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  useFilesystemSync(project);

  const projectKey = project?.id ?? WORKSPACE_NULL;
  const allBuckets = useTabsStore((s) => s.byProject);
  const bucket = allBuckets[projectKey] ?? EMPTY_BUCKET;
  const pendingClose = usePendingCloseStore((s) => s.pending);
  const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [sendToProjectFile, setSendToProjectFile] = useState<PreviewGrant | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [docHost, setDocHost] = useState<HTMLElement | null>(null);
  const setShellFocus = useSidePanelStore((s) => s.setShellFocus);

  useEffect(() => {
    useOverlayLockStore.getState().setLocal(
      worktreeDialogOpen || cloneDialogOpen || sendToProjectFile != null || pendingClose != null || quit.blocked != null,
    );
    return () => useOverlayLockStore.getState().setLocal(false);
  }, [worktreeDialogOpen, cloneDialogOpen, sendToProjectFile, pendingClose, quit.blocked]);

  const activeCwd = useMemo(
    () => project?.path ?? homeDirPath ?? "",
    [project, homeDirPath],
  );

  const agent = useActiveProcessTab(bucket.tabs, bucket.activeTabId);
  const workbenchFocus = useSidePanelStore((s) => s.focus);
  const storedDocId = useSidePanelStore((s) => s.activeDocId);
  const activeDocTabId =
    workbenchFocus === "doc" && storedDocId &&
    bucket.tabs.some((tab) => tab.id === storedDocId && isWorkbenchDocTab(tab))
      ? storedDocId
      : null;
  const panelView = useSidePanelStore((s) => s.view);
  const panelOpen = panelView !== "closed";
  const sidebarOpen = !useCodeSidebarStore((s) => s.collapsed);
  const browserWantsExpand = useBrowserUiStore((s) => s.expanded);
  const workbenchLayout = resolveWorkbenchLayout({
    view: panelView,
    browserExpanded: browserWantsExpand,
    activeDocTabId,
  });
  const browserExpanded = workbenchLayout === "browserOverlay";
  const sidePanelMounted = useDelayedFlag(panelOpen, DRAWER_ANIMATION_MS);
  const sidebarMounted = useDelayedFlag(sidebarOpen, DRAWER_ANIMATION_MS);
  const [resizing, setResizing] = useState(false);
  const viewportWidth = useViewportWidth();

  const projectsWidth = useSettingsDataStore((s) => s.settings.panels.projectsWidth);
  const sourceControlWidth = useSettingsDataStore(
    (s) => s.settings.panels.sourceControlWidth,
  );
  const updateSettings = useSettingsDataStore((s) => s.update);
  const handleProjectsWidthChange = useCallback(
    (next: number) => updateSettings("panels", { projectsWidth: Math.round(next) }),
    [updateSettings],
  );
  const handleSourceControlWidthChange = useCallback(
    (next: number) => updateSettings("panels", { sourceControlWidth: Math.round(next) }),
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
    setWorktreeDialogOpen,
    setCloneDialogOpen,
    setSendToProjectFile,
    setDropActive,
  });

  useEffect(() => registerAppCommands(actions), [actions]);

  const centerFloor = panelView === "browser" ? CENTER_FLOOR_BROWSER : CENTER_FLOOR;
  const workbenchMax = Math.max(
    PANEL_LIMITS.sourceControl.min,
    Math.min(
      PANEL_LIMITS.sourceControl.max,
      viewportWidth - (sidebarOpen ? projectsWidth : 0) - centerFloor,
    ),
  );
  const workbenchWidth = Math.min(sourceControlWidth, workbenchMax);
  const sidebarColWidth = sidebarOpen ? projectsWidth : 0;
  const sidePanelColWidth = panelOpen ? workbenchWidth : 0;
  const gridTemplateColumns =
    `${sidebarColWidth}px minmax(0,1fr) ${sidePanelColWidth}px`;

  if (bootstrap.status !== "ready") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas text-ink">
        <EmptyState
          title={bootstrap.status === "failed" ? t("bootstrap.failedTitle") : t("bootstrap.loadingTitle")}
          body={bootstrap.status === "failed" ? bootstrap.error ?? t("bootstrap.failedBody") : t("bootstrap.loadingBody")}
          action={bootstrap.status === "failed" ? (
            <Button variant="outline" size="sm" onClick={bootstrap.retry}>{t("common.retry")}</Button>
          ) : undefined}
        />
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen bg-canvas text-ink">
      <DropOverlay active={dropActive} />
      <WindowsControls />
      <ShellToggles layout={workbenchLayout} />
      <div
        className={cn(
          "grid h-full w-full grid-rows-[minmax(0,1fr)]",
          !resizing &&
            "transition-[grid-template-columns] duration-drawer ease-drawer motion-reduce:transition-none",
        )}
        style={{ gridTemplateColumns }}
      >

      <div className="relative min-w-0 overflow-hidden">
        {sidebarOpen || sidebarMounted ? (
          <>
            <div
              aria-hidden={!sidebarOpen}
              className={cn(
                "h-full transition-opacity duration-drawer ease-drawer",
                sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              style={{ width: projectsWidth }}
            >
              <AgentSidebar />
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
              enabled={sidebarOpen}
              onDraggingChange={setResizing}
            />
          </>
        ) : null}
      </div>

      <div
        className="flex min-h-0 min-w-0 flex-col"
        onPointerDownCapture={() => setShellFocus("center")}
      >
        <CenterChrome />
        <div className="min-h-0 flex-1">
          <WorkArea
            project={project}
            tabs={bucket.tabs}
            activeProcessTabId={agent?.id ?? null}
            activeDocTabId={activeDocTabId}
            docHost={docHost}
            allBuckets={allBuckets}
            activeProjectKey={projectKey}
            onNewTerminal={actions.newTerminal}
            onLaunchCli={actions.launchCli}
            onOpenFolder={actions.openFolder}
            onCloneFromGithub={actions.cloneFromGithub}
            onOpenPreviewFile={actions.pickPreviewFile}
          />
        </div>
      </div>

      <div
        className={cn(
          "relative min-w-0",
          browserExpanded && "fixed inset-0 z-30 bg-canvas",
        )}
        onPointerDownCapture={() => setShellFocus("workbench")}
      >
        <div
          ref={setDocHost}
          className="absolute bottom-0 right-0 left-px z-[1] overflow-hidden bg-canvas"
          style={{
            top: "var(--title-bar-h)",
            display: activeDocTabId && panelOpen ? "block" : "none",
          }}
        />
        {panelOpen || sidePanelMounted ? (
          <>
            <div
              aria-hidden={!panelOpen}
              className="absolute inset-0 overflow-hidden"
            >
              <div
                className={cn(
                  "absolute inset-y-0 right-0 h-full transition-opacity duration-drawer ease-drawer",
                  browserExpanded && "inset-0",
                  panelOpen ? "opacity-100" : "pointer-events-none opacity-0",
                )}
                style={{ width: browserExpanded ? undefined : workbenchWidth }}
              >
                <RightWorkbench
                  project={project}
                  tabs={bucket.tabs}
                  activeDocTabId={activeDocTabId}
                  layout={workbenchLayout}
                  onSelectDoc={(id) => {
                    useSidePanelStore.getState().focusDoc(id);
                  }}
                  onCloseDoc={actions.closeTab}
                  onMoveDoc={actions.moveTab}
                  onOpenFolder={actions.openFolder}
                  onOpenFile={actions.openFile}
                  onOpenInTerminal={actions.openInTerminal}
                  onLaunchCliInPath={actions.launchCliInPath}
                  onOpenChanges={actions.openChanges}
                />
              </div>
            </div>
            <ResizeHandle
              side="left"
              value={workbenchWidth}
              min={PANEL_LIMITS.sourceControl.min}
              max={workbenchMax}
              toDelta={(dx) => -dx}
              onChange={handleSourceControlWidthChange}
              onReset={resetSourceControlWidth}
              ariaLabel={t("appShell.resizeSidePanel")}
              enabled={panelOpen && !browserExpanded}
              onDraggingChange={setResizing}
            />
          </>
        ) : null}
      </div>
      </div>

      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />

      <CloseTabsConfirm
        state={pendingClose}
        onCancel={cancelPendingClose}
        onConfirm={() => {
          void confirmPendingClose();
        }}
      />

      <QuitBlockedDialog
        blocked={quit.blocked}
        onRetry={quit.retry}
        onForceQuit={quit.forceQuit}
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

      <NewAgentModal
        onNewTerminal={actions.newTerminal}
        onLaunchCli={actions.launchCli}
        projectPath={project?.path ?? activeCwd}
      />
      <OpenProjectModal
        onOpenFolder={actions.openFolder}
        onCloneFromGithub={actions.cloneFromGithub}
      />

      <SendToProjectDialog
        file={sendToProjectFile}
        onOpenChange={(o) => {
          if (!o) setSendToProjectFile(null);
        }}
        onSent={actions.sentToProject}
      />
      <WhatsNewDialog />
      <Toaster />
    </div>
  );
}
