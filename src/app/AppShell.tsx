import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { MiniProjectSidebar } from "@/components/project-rail/MiniProjectSidebar";
import { ExplorerPanel } from "@/components/file-explorer/ExplorerPanel";
import { WorkArea } from "@/components/tabs/WorkArea";
import { TitleBar } from "@/app/TitleBar";
import { SourceControlPanel } from "@/components/source-control/SourceControlPanel";
import {
  useTabsStore,
  WORKSPACE_NULL,
} from "@/components/tabs/tabsStore";
import type { Tab } from "@/components/tabs/types";
import { newId } from "@/lib/idGen";
import { ext } from "@/lib/path";
import { cliLaunchString, type CliTool } from "@/features/terminal/cli-registry";
import { preloadCliDetections } from "@/features/terminal/cli-detection";
import { basename } from "@/lib/path";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { useKeybindingsStore } from "@/features/keybindings/keybindings.store";
import { useExplorerStore } from "@/features/explorer/explorer.store";
import {
  workspaceApi,
  type SerializedTab,
} from "@/features/projects/workspace.service";
import { watcherApi } from "@/features/filesystem/watcher.service";
import { useGitStore } from "@/features/git/git.store";
import { useSourceControlStore } from "@/features/source-control/sourceControl.store";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { ptyApi } from "@/features/terminal/terminal.service";
import { utf8ToBase64 } from "@/lib/base64";
import { useEditorReconcile } from "@/features/editor/useEditorReconcile";
import { EV, listenTo, type FsChangedPayload } from "@/lib/events";
import { dirname } from "@/lib/path";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";
import { CMD, invoke } from "@/lib/ipc";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

type PendingClose = {
  ids: string[];
  mode: "single" | "others" | "all";
  terminals: number;
  agents: number;
  /** When mode === "single", the affected tab (for personalized copy). */
  singleTab?: Tab;
};

interface PendingDelete {
  path: string;
  name: string;
  isDir: boolean;
}

function processSummary(tabs: Tab[]): { terminals: number; agents: number } {
  let terminals = 0;
  let agents = 0;
  for (const t of tabs) {
    if (t.kind === "terminal") terminals += 1;
    else if (t.kind === "cli") agents += 1;
  }
  return { terminals, agents };
}

const EMPTY_BUCKET = { tabs: [], activeTabId: null } as {
  tabs: [];
  activeTabId: null;
};

export function AppShell() {
  const { t } = useTranslation();
  const [homeDirPath, setHomeDirPath] = useState<string | null>(null);

  // Projects store
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const hydrated = useProjectsStore((s) => s.hydrated);
  const hydrate = useProjectsStore((s) => s.hydrate);
  const addProject = useProjectsStore((s) => s.add);
  const setActive = useProjectsStore((s) => s.setActive);

  const settingsHydrated = useSettingsDataStore((s) => s.hydrated);
  const hydrateSettings = useSettingsDataStore((s) => s.hydrate);

  const keybindingsHydrated = useKeybindingsStore((s) => s.hydrated);
  const hydrateKeybindings = useKeybindingsStore((s) => s.hydrate);

  const project = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  // Hydrate user settings from ~/.metacodex/settings.json once at startup.
  useEffect(() => {
    if (!settingsHydrated) hydrateSettings();
  }, [settingsHydrated, hydrateSettings]);

  // Hydrate custom keybindings from ~/.metacodex/keybindings.json once at startup.
  useEffect(() => {
    if (!keybindingsHydrated) hydrateKeybindings();
  }, [keybindingsHydrated, hydrateKeybindings]);

  // Warm the CLI-detection cache at boot. Each probe shells out through a
  // login shell which is slow on macOS; doing it eagerly here means the
  // launcher menu opens with results already resolved.
  useEffect(() => {
    preloadCliDetections();
  }, []);

  // Keep open editor buffers in sync with files agents edit from terminal tabs.
  useEditorReconcile();

  useEffect(() => {
    (async () => {
      try {
        const h = await homeDir();
        setHomeDirPath(h.replace(/\/+$/, ""));
      } catch {
        setHomeDirPath(null);
      }
    })();
  }, []);

  // Tabs store keyed per project.
  const projectKey = project?.id ?? WORKSPACE_NULL;
  // Subscribe to ALL buckets — TabContent mounts every project's tabs so PTYs
  // and editor buffers survive a project switch (hidden via display:none for
  // anything other than the active project's active tab).
  const allBuckets = useTabsStore((s) => s.byProject);
  const bucket = allBuckets[projectKey] ?? EMPTY_BUCKET;
  const openTab = useTabsStore((s) => s.openTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const closeMany = useTabsStore((s) => s.closeMany);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);

  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [skipDeleteInSession, setSkipDeleteInSession] = useState(false);
  // Mirror skipDeleteInSession in a ref so the latest value is visible to the
  // checkbox handler that lives inside the dialog (which closes the dialog
  // before re-rendering the confirm callback in some flows).
  const skipDeleteRef = useRef(false);
  skipDeleteRef.current = skipDeleteInSession;

  const activeCwd = useMemo(
    () => project?.path ?? homeDirPath ?? "/",
    [project, homeDirPath],
  );

  const refreshGit = useGitStore((s) => s.refresh);
  const panelOpen = useSourceControlStore((s) => s.open);

  // -- File watcher per project ------------------------------------------------
  // When the active project changes, ask Rust to watch its root. Stop on unmount.
  useEffect(() => {
    if (!project) return;
    void watcherApi.watch(project.id, project.path).catch((err) => {
      console.warn("[watcher] watch failed", err);
    });
    return () => {
      void watcherApi.unwatch(project.id).catch(() => undefined);
    };
  }, [project]);

  // Listen for filesystem changes globally and route to the right project.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const off = await listenTo<FsChangedPayload>(EV.fsChanged, (e) => {
        const { projectId, paths } = e.payload;
        const explorer = useExplorerStore.getState();
        // Invalidate cached children for any directory that contains an event path.
        const dirs = new Set<string>();
        for (const p of paths) {
          dirs.add(dirname(p));
        }
        const bucket = explorer.byProject[projectId];
        if (bucket) {
          for (const d of dirs) {
            if (bucket.children[d]) {
              void explorer.refresh(projectId, d);
            }
          }
        }
        // Refresh git status — file changes typically alter git state.
        const proj = useProjectsStore
          .getState()
          .projects.find((p) => p.id === projectId);
        if (proj) {
          void useGitStore.getState().refresh(projectId, proj.path);
        }
      });
      unlisten = off;
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  // Refresh git status when the active project changes.
  useEffect(() => {
    if (!project) return;
    void refreshGit(project.id, project.path);
  }, [project, refreshGit]);

  // -- Workspace persistence ----------------------------------------------------
  // Tracks which project buckets have already been hydrated from the persisted
  // workspaceState so we don't replay restoration on every render and also
  // don't save a clobbering empty state before hydration completes.
  const hydratedWorkspaces = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!project) return;
    if (hydratedWorkspaces.current.has(project.id)) return;
    hydratedWorkspaces.current.add(project.id);
    (async () => {
      try {
        const ws = await workspaceApi.load(project.id);
        if (!ws) return;
        const tabsStore = useTabsStore.getState();
        for (const st of ws.openTabs) {
          let tab: Tab | null = null;
          if (st.kind === "editor" && st.path) {
            tab = { id: st.id, kind: "editor", title: st.title, projectId: project.id, path: st.path };
          } else if (st.kind === "markdown" && st.path) {
            tab = {
              id: st.id,
              kind: "markdown",
              title: st.title,
              projectId: project.id,
              path: st.path,
              mode: (st.mode as "preview" | "source") ?? "preview",
            };
          } else if (st.kind === "image" && st.path) {
            tab = { id: st.id, kind: "image", title: st.title, projectId: project.id, path: st.path };
          } else if (st.kind === "pdf" && st.path) {
            tab = { id: st.id, kind: "pdf", title: st.title, projectId: project.id, path: st.path };
          }
          if (tab) tabsStore.openTab(project.id, tab, false);
        }
        if (ws.activeTabId) tabsStore.setActiveTab(project.id, ws.activeTabId);
        if (ws.expandedPaths.length > 0) {
          const expStore = useExplorerStore.getState();
          for (const p of ws.expandedPaths) {
            void expStore.toggleExpand(project.id, p);
          }
        }
      } catch (err) {
        console.warn("[workspace] load failed", err);
      }
    })();
  }, [project]);

  useEffect(() => {
    if (!project) return;
    if (!hydratedWorkspaces.current.has(project.id)) return;
    // Read the debounce imperatively so changing it doesn't re-arm this effect.
    const saveDebounceMs =
      useSettingsDataStore.getState().settings.performance.workspaceSaveDebounceMs;
    const handle = setTimeout(() => {
      const cur = useTabsStore.getState().byProject[project.id];
      const explorerBucket = useExplorerStore.getState().byProject[project.id];
      const expandedPaths = explorerBucket ? Array.from(explorerBucket.expanded) : [];
      const persistTabs: SerializedTab[] = (cur?.tabs ?? [])
        .map((t): SerializedTab | null => {
          if (t.kind === "markdown") {
            return { id: t.id, kind: "markdown", title: t.title, path: t.path, mode: t.mode };
          }
          if (t.kind === "editor" || t.kind === "image" || t.kind === "pdf") {
            return { id: t.id, kind: t.kind, title: t.title, path: t.path };
          }
          return null;
        })
        .filter((t): t is SerializedTab => t !== null);
      workspaceApi
        .save(project.id, {
          openTabs: persistTabs,
          activeTabId: cur?.activeTabId ?? null,
          expandedPaths,
        })
        .catch((err) => console.warn("[workspace] save failed", err));
    }, saveDebounceMs);
    return () => clearTimeout(handle);
  }, [project, bucket.tabs, bucket.activeTabId]);

  // -- Actions ------------------------------------------------------------------
  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("appShell.openFolderTitle"),
      });
      if (typeof selected === "string" && selected.length > 0) {
        await addProject(selected);
      }
    } catch (err) {
      console.error("openDialog failed", err);
    }
  }, [addProject, t]);

  const handleNewTerminal = useCallback(() => {
    openTab(projectKey, {
      id: `t-${newId(10)}`,
      kind: "terminal",
      title: project ? project.name : "terminal",
      projectId: project?.id ?? null,
      cwd: activeCwd,
    });
  }, [openTab, projectKey, project, activeCwd]);

  // Send text (an editor selection) to the terminal: the last-focused terminal
  // in this project, falling back to any running one, else open a new terminal
  // pre-filled with the text (no trailing Enter — the user reviews and submits).
  const sendToTerminal = useCallback(
    (text: string) => {
      const payload = text.replace(/\s+$/, "");
      if (!payload) return;
      const store = useTerminalStore.getState();
      let sid = store.getLastFocused(projectKey);
      let session = sid ? store.getById(sid) : undefined;
      if (!session || session.status !== "running") {
        const candidate = Object.values(store.sessions).find(
          (s) => s.status === "running" && (s.projectId ?? WORKSPACE_NULL) === projectKey,
        );
        sid = candidate?.id;
        session = candidate;
      }
      if (sid && session && session.status === "running") {
        void ptyApi.write(sid, utf8ToBase64(payload)).catch(() => undefined);
        if (session.tabId) setActiveTab(projectKey, session.tabId); // reveal it
      } else {
        openTab(projectKey, {
          id: `t-${newId(10)}`,
          kind: "terminal",
          title: project ? project.name : "terminal",
          projectId: project?.id ?? null,
          cwd: activeCwd,
          prefillCommand: payload,
        });
      }
    },
    [openTab, setActiveTab, projectKey, project, activeCwd],
  );

  const handleLaunchCli = useCallback(
    (cli: CliTool) => {
      const launchCommand = cliLaunchString(cli);
      openTab(projectKey, {
        id: `c-${newId(10)}`,
        kind: "cli",
        title: cli.label,
        projectId: project?.id ?? null,
        cwd: activeCwd,
        cliId: cli.id,
        launchCommand,
      });
    },
    [openTab, projectKey, project, activeCwd],
  );

  const requestClose = useCallback(
    (mode: PendingClose["mode"], targets: Tab[], singleTab?: Tab) => {
      const ids = targets.map((t) => t.id);
      if (ids.length === 0) return;
      const { terminals, agents } = processSummary(targets);
      if (terminals === 0 && agents === 0) {
        closeMany(projectKey, ids);
        return;
      }
      setPendingClose({ ids, mode, terminals, agents, singleTab });
    },
    [closeMany, projectKey],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const target = bucket.tabs.find((t) => t.id === tabId);
      if (!target) return;
      if (target.kind === "terminal" || target.kind === "cli") {
        requestClose("single", [target], target);
      } else {
        closeTab(projectKey, tabId);
      }
    },
    [bucket.tabs, closeTab, projectKey, requestClose],
  );

  const handleCloseOthers = useCallback(
    (keepId: string) => {
      const targets = bucket.tabs.filter((t) => t.id !== keepId);
      requestClose("others", targets);
    },
    [bucket.tabs, requestClose],
  );

  const handleCloseAll = useCallback(() => {
    requestClose("all", bucket.tabs);
  }, [bucket.tabs, requestClose]);

  const handleSelectTab = useCallback(
    (tabId: string) => setActiveTab(projectKey, tabId),
    [setActiveTab, projectKey],
  );

  const handleCopyTabPath = useCallback(
    (tabId: string) => {
      const tab = bucket.tabs.find((t) => t.id === tabId);
      if (!tab || !("path" in tab) || !tab.path) return;
      navigator.clipboard.writeText(tab.path).catch((err) => {
        console.warn("[clipboard] copy path failed", err);
      });
    },
    [bucket.tabs],
  );

  const handleRevealTabInFinder = useCallback(
    (tabId: string) => {
      const tab = bucket.tabs.find((t) => t.id === tabId);
      if (!tab || !("path" in tab) || !tab.path) return;
      invoke(CMD.revealInFinder, { path: tab.path }).catch((err) => {
        console.warn("[reveal_in_finder] failed", err);
      });
    },
    [bucket.tabs],
  );

  const handleCopyTabCwd = useCallback(
    (tabId: string) => {
      const tab = bucket.tabs.find((t) => t.id === tabId);
      if (!tab || !("cwd" in tab) || !tab.cwd) return;
      navigator.clipboard.writeText(tab.cwd).catch((err) => {
        console.warn("[clipboard] copy cwd failed", err);
      });
    },
    [bucket.tabs],
  );

  const performDelete = useCallback(
    async (target: PendingDelete) => {
      if (!project) return;
      try {
        await useExplorerStore.getState().deleteNode(project.id, target.path);
        useTabsStore.getState().closeForRemovedPath(project.id, target.path);
      } catch (err) {
        console.warn("[explorer] delete failed", err);
        window.alert(
          t("appShell.deleteFailed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
    [project, t],
  );

  const handleRequestDelete = useCallback(
    (path: string, name: string, isDir: boolean) => {
      if (skipDeleteRef.current) {
        void performDelete({ path, name, isDir });
        return;
      }
      setPendingDelete({ path, name, isDir });
    },
    [performDelete],
  );

  const handleRename = useCallback(
    async (path: string, newName: string, _isDir: boolean): Promise<string> => {
      if (!project) throw new Error("no active project");
      const newPath = await useExplorerStore
        .getState()
        .renameNode(project.id, path, newName);
      useTabsStore.getState().remapForRename(project.id, path, newPath);
      return newPath;
    },
    [project],
  );

  const handleMove = useCallback(
    async (from: string, toDir: string): Promise<void> => {
      if (!project) return;
      try {
        const newPath = await useExplorerStore
          .getState()
          .moveNode(project.id, from, toDir);
        useTabsStore.getState().remapForRename(project.id, from, newPath);
      } catch (err) {
        console.warn("[explorer] move failed", err);
        window.alert(
          t("appShell.moveFailed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
    [project, t],
  );

  const handleOpenInTerminal = useCallback(
    (path: string, name: string) => {
      openTab(projectKey, {
        id: `t-${newId(10)}`,
        kind: "terminal",
        title: name || basename(path),
        projectId: project?.id ?? null,
        cwd: path,
      });
    },
    [openTab, projectKey, project],
  );

  const handleLaunchCliInPath = useCallback(
    (cli: CliTool, path: string, name: string) => {
      const launchCommand = cliLaunchString(cli);
      openTab(projectKey, {
        id: `c-${newId(10)}`,
        kind: "cli",
        title: `${cli.label} · ${name || basename(path)}`,
        projectId: project?.id ?? null,
        cwd: path,
        cliId: cli.id,
        launchCommand,
      });
    },
    [openTab, projectKey, project],
  );

  const handleOpenFile = useCallback(
    (path: string, name: string) => {
      if (!project) return;
      const e = ext(name);
      const id = `f-${path}`;
      let tab: Tab;
      if (["md", "mdx", "markdown"].includes(e)) {
        tab = {
          id,
          kind: "markdown",
          title: name,
          projectId: project.id,
          path,
          mode: "preview",
        };
      } else if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) {
        tab = { id, kind: "image", title: name, projectId: project.id, path };
      } else if (e === "pdf") {
        tab = { id, kind: "pdf", title: name, projectId: project.id, path };
      } else {
        tab = { id, kind: "editor", title: name, projectId: project.id, path };
      }
      openTab(projectKey, tab);
    },
    [openTab, projectKey, project],
  );

  const handleOpenDiff = useCallback(
    (path: string, status: string) => {
      if (!project) return;
      openTab(projectKey, {
        id: `diff-${path}`,
        kind: "diff",
        title: basename(path),
        projectId: project.id,
        path,
        status,
      });
    },
    [openTab, projectKey, project],
  );

  const closeActiveTab = useCallback(() => {
    if (!bucket.activeTabId) return;
    closeTab(projectKey, bucket.activeTabId);
  }, [bucket.activeTabId, closeTab, projectKey]);

  const switchProject = useCallback(
    (n: number) => {
      const target = projects[n - 1];
      if (target) void setActive(target.id);
    },
    [projects, setActive],
  );

  useEffect(() => {
    (window as any).__metacodex = {
      newTerminal: handleNewTerminal,
      openFolder: handleOpenFolder,
      closeActiveTab,
      switchProject,
      openFile: handleOpenFile,
      sendToTerminal,
    };
    return () => {
      delete (window as any).__metacodex;
    };
  }, [
    handleNewTerminal,
    handleOpenFolder,
    closeActiveTab,
    switchProject,
    handleOpenFile,
    sendToTerminal,
  ]);

  return (
    <div
      className={cn(
        "grid h-screen w-screen grid-rows-[36px_minmax(0,1fr)] bg-canvas text-ink",
        panelOpen
          ? "grid-cols-[56px_248px_minmax(0,1fr)_340px]"
          : "grid-cols-[56px_248px_minmax(0,1fr)]",
      )}
    >
      <TitleBar workspaceName={project?.name} className="col-span-full" />

      <MiniProjectSidebar onOpenFolder={handleOpenFolder} />

      <ExplorerPanel
        hasProject={!!project}
        projectId={project?.id}
        projectName={project?.name}
        projectPath={project?.path}
        onOpenFolder={handleOpenFolder}
        onOpenFile={handleOpenFile}
        onRequestDelete={handleRequestDelete}
        onRename={handleRename}
        onOpenInTerminal={handleOpenInTerminal}
        onLaunchCliInPath={handleLaunchCliInPath}
        onMove={handleMove}
      />

      <WorkArea
        project={project}
        tabs={bucket.tabs}
        activeTabId={bucket.activeTabId}
        allBuckets={allBuckets}
        activeProjectKey={projectKey}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onCloseOthers={handleCloseOthers}
        onCloseAll={handleCloseAll}
        onCopyTabPath={handleCopyTabPath}
        onRevealTabInFinder={handleRevealTabInFinder}
        onCopyTabCwd={handleCopyTabCwd}
        onNewTerminal={handleNewTerminal}
        onLaunchCli={handleLaunchCli}
        onOpenFolder={handleOpenFolder}
      />

      {panelOpen ? (
        project ? (
          <SourceControlPanel
            projectId={project.id}
            projectPath={project.path}
            onOpenDiff={handleOpenDiff}
          />
        ) : (
          <aside className="flex h-full min-h-0 flex-col items-center justify-center border-l border-hairline bg-canvas px-[24px] text-center">
            <p className="font-mono text-[12px] text-muted">
              {t("sourceControl.noProject")}
            </p>
          </aside>
        )
      ) : null}

      <CloseTabsConfirm
        state={pendingClose}
        onCancel={() => setPendingClose(null)}
        onConfirm={() => {
          if (!pendingClose) return;
          closeMany(projectKey, pendingClose.ids);
          setPendingClose(null);
        }}
      />

      <DeleteNodeConfirm
        state={pendingDelete}
        skipChecked={skipDeleteInSession}
        onSkipChange={setSkipDeleteInSession}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          const target = pendingDelete;
          setPendingDelete(null);
          void performDelete(target);
        }}
      />
    </div>
  );
}

interface CloseTabsConfirmProps {
  state: PendingClose | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function CloseTabsConfirm({ state, onConfirm, onCancel }: CloseTabsConfirmProps) {
  const { t } = useTranslation();
  const open = state !== null;
  const copy = state ? confirmCopyFor(state, t) : null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      tone="destructive"
      title={copy?.title ?? ""}
      description={copy?.description}
      details={copy?.details}
      confirmLabel={copy?.confirm ?? t("appShell.closeFallbackConfirm")}
      cancelLabel={t("common.cancel")}
      onConfirm={onConfirm}
    />
  );
}

interface DeleteNodeConfirmProps {
  state: PendingDelete | null;
  skipChecked: boolean;
  onSkipChange: (next: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function DeleteNodeConfirm({
  state,
  skipChecked,
  onSkipChange,
  onCancel,
  onConfirm,
}: DeleteNodeConfirmProps) {
  const { t } = useTranslation();
  const open = state !== null;
  const isDir = state?.isDir ?? false;
  const title = state
    ? isDir
      ? t("appShell.deleteFolderTitle", { name: state.name })
      : t("appShell.deleteFileTitle", { name: state.name })
    : "";
  const description = state
    ? isDir
      ? t("appShell.deleteFolderDescription")
      : t("appShell.deleteFileDescription")
    : "";
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      tone="destructive"
      title={title}
      description={description}
      details={
        state ? (
          <span className="font-mono text-[11px] text-muted-soft">
            {state.path}
          </span>
        ) : null
      }
      confirmLabel={isDir ? t("appShell.deleteConfirmFolder") : t("appShell.deleteConfirmFile")}
      cancelLabel={t("common.cancel")}
      onConfirm={onConfirm}
      skipOption={{
        label: t("appShell.deleteSkip"),
        checked: skipChecked,
        onChange: onSkipChange,
      }}
    />
  );
}

function confirmCopyFor(
  s: PendingClose,
  t: TFunction,
): {
  title: string;
  description: string;
  details?: React.ReactNode;
  confirm: string;
} {
  if (s.mode === "single" && s.singleTab) {
    const tab = s.singleTab;
    const details =
      "cwd" in tab && tab.cwd ? (
        <span className="font-mono text-[11px] text-muted-soft">{tab.cwd}</span>
      ) : null;
    if (tab.kind === "cli") {
      return {
        title: t("appShell.closeAgentTitle", { title: tab.title }),
        description: t("appShell.closeAgentDescription"),
        details,
        confirm: t("appShell.closeAgentConfirm"),
      };
    }
    return {
      title: t("appShell.closeTerminalTitle"),
      description: t("appShell.closeTerminalDescription"),
      details,
      confirm: t("appShell.closeTerminalConfirm"),
    };
  }

  const parts: string[] = [];
  if (s.terminals > 0) parts.push(t("appShell.terminalCount", { count: s.terminals }));
  if (s.agents > 0) parts.push(t("appShell.agentCount", { count: s.agents }));
  const inventory = parts.join(t("appShell.and"));

  const title =
    s.mode === "all" ? t("appShell.closeAllTitle") : t("appShell.closeOthersTitle");
  return {
    title,
    description: t("appShell.closeManyDescription", {
      inventory,
      count: s.terminals + s.agents,
    }),
    confirm: t("appShell.closeManyConfirm"),
  };
}
