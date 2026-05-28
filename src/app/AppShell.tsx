import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { MiniProjectSidebar } from "@/components/project-rail/MiniProjectSidebar";
import { ExplorerPanel } from "@/components/file-explorer/ExplorerPanel";
import { WorkArea } from "@/components/tabs/WorkArea";
import { TitleBar } from "@/app/TitleBar";
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
import { UI_DENSITY_MULTIPLIER } from "@/features/settings/settings.types";
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
import {
  EV,
  listenTo,
  type FsChangedPayload,
  type FsRenamedPayload,
  type PtyBackpressurePayload,
  type PtyExitPayload,
} from "@/lib/events";
import { dirname } from "@/lib/path";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import { PANEL_LIMITS } from "@/features/settings/settings.types";
import { CMD, invoke } from "@/lib/ipc";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  attentionOrder,
  useAgentStatusStore,
} from "@/features/terminal/agent-status.store";
import { useTabMetadataPolling } from "@/features/terminal/useTabMetadataPolling";
import { SourceControlPanel } from "@/components/source-control/SourceControlPanel";
import { useWorktreesStore } from "@/features/git/worktrees.store";
import { useWorktreeOccupancySync } from "@/features/git/useWorktreeOccupancySync";
import { WorktreeCreateDialog } from "@/components/source-control/WorktreeCreateDialog";
import { CloneFromGithubDialog } from "@/components/project-rail/CloneFromGithubDialog";
import { useResumeStore } from "@/features/resume/resume.store";
import { recordDiag, useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";
import { useSaveStatusStore } from "@/features/workspace/saveStatus.store";
import { checkSilent as checkUpdatesSilent } from "@/features/updates/updates.service";

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

interface PendingMove {
  from: string;
  toDir: string;
  name: string;
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

  // Drive the global density multiplier from settings. The CSS var multiplies
  // every --space-* token so a single toggle reflows the whole chrome rhythm.
  const uiDensity = useSettingsDataStore((s) => s.settings.interface.uiDensity);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--density-multiplier",
      String(UI_DENSITY_MULTIPLIER[uiDensity]),
    );
  }, [uiDensity]);

  // Hydrate custom keybindings from ~/.metacodex/keybindings.json once at startup.
  useEffect(() => {
    if (!keybindingsHydrated) hydrateKeybindings();
  }, [keybindingsHydrated, hydrateKeybindings]);

  // Hydrate the resume registry from ~/.metacodex/state/resume.json. We pull
  // the last 30 days — older entries already pruned at startup by Rust.
  useEffect(() => {
    void useResumeStore.getState().hydrate();
  }, []);

  // Warm the CLI-detection cache at boot. Each probe shells out through a
  // login shell which is slow on macOS; doing it eagerly here means the
  // launcher menu opens with results already resolved.
  useEffect(() => {
    preloadCliDetections();
  }, []);

  // Silent updater probe. Delayed past initial paint + hydration so it never
  // competes for IPC bandwidth on cold boot; skipped entirely in dev mode by
  // the service (no installed binary to compare against).
  useEffect(() => {
    const handle = window.setTimeout(() => {
      void checkUpdatesSilent();
    }, 3000);
    return () => window.clearTimeout(handle);
  }, []);

  // Keep open editor buffers in sync with files agents edit from terminal tabs.
  useEditorReconcile();

  // Pulse branch / cwd / listening-ports for each running PTY into the
  // tab-metadata store. Powers the TabTooltip + TabInspectorPanel.
  useTabMetadataPolling();

  // Maintain `occupancyByPath` (worktree path → tabId[]) so the worktrees
  // section can flag entries currently in use.
  useWorktreeOccupancySync();

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
  const moveTabStore = useTabsStore((s) => s.moveTab);
  const setTabTitles = useTabsStore((s) => s.setTabTitles);
  const setEditingTabId = useTabsStore((s) => s.setEditingTabId);

  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [skipDeleteInSession, setSkipDeleteInSession] = useState(false);
  const [skipMoveInSession, setSkipMoveInSession] = useState(false);
  const skipMoveRef = useRef(false);
  skipMoveRef.current = skipMoveInSession;
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

  // Resizable panel widths — driven by settings, persisted to ~/.metacodex.
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
    let unlistenRenamed: (() => void) | undefined;
    (async () => {
      const off = await listenTo<FsChangedPayload>(EV.fsChanged, async (e) => {
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
        // External rm / external rename: stat each touched path. Anything
        // that no longer exists AND is currently open as a file-backed tab
        // gets closed so the user doesn't end up saving into a dead path.
        // In-app rename takes a different code path (fs://renamed below)
        // and updates the tab's path WITHOUT closing.
        const bucket2 = useTabsStore.getState().byProject[projectId];
        if (bucket2) {
          const openFilePaths = new Set<string>();
          for (const t of bucket2.tabs) {
            if ("path" in t && (t as { path?: string }).path) {
              openFilePaths.add((t as { path: string }).path);
            }
          }
          // Only stat paths that match an open tab — keeps the IPC blast
          // small even when the watcher fires for hundreds of changes.
          const candidates = paths.filter((p) => openFilePaths.has(p));
          for (const p of candidates) {
            try {
              await invoke(CMD.stat, { path: p });
            } catch {
              // stat failure (ENOENT or otherwise) → close the tab(s) at this path.
              useTabsStore.getState().closeForRemovedPath(projectId, p);
              recordDiag("tab.close_external", { projectId, detail: { path: p } });
            }
          }
        }
      });
      const offRen = await listenTo<FsRenamedPayload>(EV.fsRenamed, (e) => {
        const { projectId, oldPath, newPath } = e.payload;
        useTabsStore.getState().remapForRename(projectId, oldPath, newPath);
        recordDiag("fs.renamed", { projectId, detail: { oldPath, newPath } });
      });
      unlisten = off;
      unlistenRenamed = offRen;
    })();
    return () => {
      unlisten?.();
      unlistenRenamed?.();
    };
  }, []);

  // Refresh git status when the active project changes.
  useEffect(() => {
    if (!project) return;
    void refreshGit(project.id, project.path);
    void useWorktreesStore.getState().refresh(project.id, project.path);
  }, [project, refreshGit]);

  // -- Workspace persistence ----------------------------------------------------
  // Tri-state per project:
  //   "pending" — load issued, not yet resolved. Saves are blocked.
  //   "loaded"  — load succeeded; saves are allowed.
  //   "failed"  — load errored or returned corrupt data. Saves stay BLOCKED for
  //               the rest of the session so a stale empty bucket can't clobber
  //               the file on disk. User sees a save-status dot in red.
  //
  // The old single-Set design called .add() synchronously BEFORE awaiting
  // workspaceApi.load(), which meant a failed/empty load was indistinguishable
  // from a successful one — the next save fired and overwrote disk with {tabs:[]}.
  const hydrationStatus = useRef<Map<string, "pending" | "loaded" | "failed">>(new Map());

  // Forget hydration marks for projects that no longer exist — otherwise
  // re-adding a folder with the same id (Rust hashes by path) would skip
  // the workspace reload and ship a stale bucket.
  useEffect(() => {
    const live = new Set(projects.map((p) => p.id));
    for (const id of Array.from(hydrationStatus.current.keys())) {
      if (!live.has(id)) hydrationStatus.current.delete(id);
    }
  }, [projects]);

  useEffect(() => {
    if (!project) return;
    if (hydrationStatus.current.has(project.id)) return;
    hydrationStatus.current.set(project.id, "pending");
    const projectId = project.id;
    (async () => {
      try {
        const ws = await workspaceApi.load(projectId);
        const tabsStore = useTabsStore.getState();
        if (ws) {
          for (const st of ws.openTabs) {
            let tab: Tab | null = null;
            if (st.kind === "editor" && st.path) {
              tab = { id: st.id, kind: "editor", title: st.title, projectId, path: st.path };
            } else if (st.kind === "markdown" && st.path) {
              tab = {
                id: st.id,
                kind: "markdown",
                title: st.title,
                projectId,
                path: st.path,
                mode: (st.mode as "preview" | "source") ?? "preview",
              };
            } else if (st.kind === "image" && st.path) {
              tab = { id: st.id, kind: "image", title: st.title, projectId, path: st.path };
            } else if (st.kind === "pdf" && st.path) {
              tab = { id: st.id, kind: "pdf", title: st.title, projectId, path: st.path };
            }
            if (tab) tabsStore.openTab(projectId, tab, false);
          }
          if (ws.activeTabId) tabsStore.setActiveTab(projectId, ws.activeTabId);
          if (ws.expandedPaths.length > 0) {
            const expStore = useExplorerStore.getState();
            for (const p of ws.expandedPaths) {
              void expStore.toggleExpand(projectId, p);
            }
          }
        }
        // Mark loaded AFTER all the openTab/setActiveTab calls complete so
        // their state mutations don't trigger a premature save effect run.
        hydrationStatus.current.set(projectId, "loaded");
      } catch (err) {
        // Refuse to save for this project this session — disk file stays as-is.
        hydrationStatus.current.set(projectId, "failed");
        recordDiag("workspace.load.fail", {
          projectId,
          detail: { error: err instanceof Error ? err.message : String(err) },
        });
        console.warn("[workspace] load failed", err);
      }
    })();
  }, [project]);

  // Pending save timers, keyed by projectId. Kept in a ref (not closure-local)
  // so the before-quit listener can iterate ALL pending timers and flush them
  // synchronously regardless of which project is currently active.
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Snapshot+save helper used by both the debounced effect and the quit flush.
  const performWorkspaceSave = useCallback(async (projectId: string) => {
    const cur = useTabsStore.getState().byProject[projectId];
    const explorerBucket = useExplorerStore.getState().byProject[projectId];
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
    useSaveStatusStore.getState().beginSave();
    try {
      await workspaceApi.save(projectId, {
        openTabs: persistTabs,
        activeTabId: cur?.activeTabId ?? null,
        expandedPaths,
      });
      useSaveStatusStore.getState().markSaved();
      recordDiag("workspace.save.ok", { projectId, detail: { tabs: persistTabs.length } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useSaveStatusStore.getState().markFailed(message);
      recordDiag("workspace.save.fail", {
        projectId,
        detail: { error: message },
      });
      console.warn("[workspace] save failed", err);
    }
  }, []);

  // Global PTY observability: forward backpressure + exit events into the
  // diagnostics ring buffer so Cmd+Shift+D shows them regardless of which tab
  // is active. Per-tab UX (banners, status dot) is handled separately in
  // TerminalTab — this is observability only.
  useEffect(() => {
    let offBp: (() => void) | undefined;
    let offExit: (() => void) | undefined;
    (async () => {
      offBp = await listenTo<PtyBackpressurePayload>(EV.ptyBackpressure, (e) => {
        recordDiag("pty.backpressure", {
          sessionId: e.payload.sessionId,
          detail: { queueDepth: e.payload.queueDepth, stalledMs: e.payload.stalledMs },
        });
      });
      offExit = await listenTo<PtyExitPayload>(EV.ptyExit, (e) => {
        const reason = e.payload.reason ?? "normal";
        const kind = reason === "reader_error" ? "pty.reader_error" : "pty.exit";
        recordDiag(kind, {
          sessionId: e.payload.session_id,
          detail: { exitCode: e.payload.exit_code, reason },
        });
      });
    })();
    return () => {
      offBp?.();
      offExit?.();
    };
  }, []);

  // Listen for the Rust quit handshake (Cmd+Q → prevent_close → emit
  // app://before-quit → 300ms budget → kill_all → exit). When it fires we
  // flush every "loaded" project's pending save SYNCHRONOUSLY so debounced
  // changes don't disappear with the app process.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const off = await listenTo<unknown>(EV.beforeQuit, async () => {
        // Cancel all pending debounce timers — we're about to save explicitly.
        for (const timer of saveTimers.current.values()) clearTimeout(timer);
        saveTimers.current.clear();
        const loadedProjects = Array.from(hydrationStatus.current.entries())
          .filter(([, status]) => status === "loaded")
          .map(([id]) => id);
        await Promise.all(loadedProjects.map((pid) => performWorkspaceSave(pid)));
        recordDiag("app.before_quit", {
          detail: { savedCount: loadedProjects.length },
        });
        // Best-effort dump of the diagnostics ring buffer to disk so the user
        // can read the last session's events after a crash / quick quit.
        try {
          await invoke(CMD.diagWriteSessionLog, {
            payload: useDiagnosticsStore.getState().serialize(),
          });
        } catch {
          // ignore — disk dump is observability, not load-bearing
        }
      });
      if (cancelled) {
        off();
        return;
      }
      unlisten = off;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [performWorkspaceSave]);

  useEffect(() => {
    if (!project) return;
    if (hydrationStatus.current.get(project.id) !== "loaded") return;
    const projectId = project.id;
    // Read the debounce imperatively so changing it doesn't re-arm this effect.
    const saveDebounceMs =
      useSettingsDataStore.getState().settings.performance.workspaceSaveDebounceMs;
    // Clear any previous pending timer for this project (latest write wins).
    const prev = saveTimers.current.get(projectId);
    if (prev) clearTimeout(prev);
    const handle = setTimeout(() => {
      saveTimers.current.delete(projectId);
      void performWorkspaceSave(projectId);
    }, saveDebounceMs);
    saveTimers.current.set(projectId, handle);
    // On unmount / project switch: flush immediately INSTEAD of dropping the
    // pending save — guarantees the bucket we're leaving lands on disk even if
    // the user switched within the debounce window.
    return () => {
      const pending = saveTimers.current.get(projectId);
      if (pending) {
        clearTimeout(pending);
        saveTimers.current.delete(projectId);
        void performWorkspaceSave(projectId);
      }
    };
  }, [project, bucket.tabs, bucket.activeTabId, performWorkspaceSave]);

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

  const handleCloneFromGithub = useCallback(() => {
    setCloneDialogOpen(true);
  }, []);

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

  const handleOpenWorktreeDialog = useCallback(() => {
    if (!project) return;
    setWorktreeDialogOpen(true);
  }, [project]);

  const handleAfterWorktreeCreate = useCallback(
    ({ branch, path }: { branch: string; path: string }) => {
      setWorktreeDialogOpen(false);
      if (!project) return;
      // Open a plain terminal pointing at the new worktree path. The user can
      // then pick a CLI from there or just work with their shell.
      openTab(projectKey, {
        id: `t-${newId(10)}`,
        kind: "terminal",
        title: branch,
        projectId: project.id,
        cwd: path,
      });
    },
    [openTab, projectKey, project],
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

  // Manual rename. Empty / whitespace-only input clears the user override —
  // the tab falls back to agentTitle / default. Otherwise we cap to a hard
  // limit so a stuffed string can't blow up the tab width.
  const handleRenameTab = useCallback(
    (tabId: string, newTitle: string) => {
      const trimmed = newTitle.trim();
      const next = trimmed ? trimmed.slice(0, 60) : null;
      setTabTitles(projectKey, tabId, { userTitle: next });
    },
    [setTabTitles, projectKey],
  );

  const handleMoveTab = useCallback(
    (tabId: string, toIndex: number) => {
      moveTabStore(projectKey, tabId, toIndex);
    },
    [moveTabStore, projectKey],
  );

  // Triggered by F2 — finds the active tab and enters inline rename mode.
  // No-op if the active tab isn't renamable (file tabs) or there's no
  // active tab.
  const renameActiveTab = useCallback(() => {
    const id = bucket.activeTabId;
    if (!id) return;
    const tab = bucket.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.kind !== "terminal" && tab.kind !== "cli") return;
    setEditingTabId(id);
  }, [bucket.activeTabId, bucket.tabs, setEditingTabId]);

  // Triggered by Alt+←/Alt+→ — keyboard equivalent of the drag-reorder, so
  // users who can't (or don't want to) drag can still rearrange tabs.
  const moveActiveTab = useCallback(
    (delta: -1 | 1) => {
      const id = bucket.activeTabId;
      if (!id) return;
      const idx = bucket.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const next = idx + delta;
      if (next < 0 || next >= bucket.tabs.length) return;
      moveTabStore(projectKey, id, next);
    },
    [bucket.activeTabId, bucket.tabs, moveTabStore, projectKey],
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
      // The Rust command emits `fs://renamed` synchronously after the rename
      // succeeds — the global listener calls tabsStore.remapForRename, so we
      // don't need a local call here (would be a redundant no-op).
      return useExplorerStore
        .getState()
        .renameNode(project.id, path, newName);
    },
    [project],
  );

  const performMove = useCallback(
    async (from: string, toDir: string): Promise<void> => {
      if (!project) return;
      try {
        // Same as handleRename: Rust emits fs://renamed which drives the tab
        // remap centrally — no local call needed.
        await useExplorerStore
          .getState()
          .moveNode(project.id, from, toDir);
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

  const handleMove = useCallback(
    async (from: string, toDir: string): Promise<void> => {
      if (!project) return;
      // No-op moves (drop into current parent) skip the dialog — almost always
      // an accidental drag the user just dropped right back where it started.
      if (dirname(from) === toDir) return;
      if (skipMoveRef.current) {
        void performMove(from, toDir);
        return;
      }
      setPendingMove({ from, toDir, name: basename(from) });
    },
    [project, performMove],
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
    (path: string, name: string, openInEditMode?: boolean) => {
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
          mode: openInEditMode ? "source" : "preview",
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

  // Cmd+Shift+U: walk through tabs that are flagged needs-attention (then done)
  // in the CURRENT project's bucket. Wrap around — if we're already on the
  // most-urgent tab, the next press goes to the second-most-urgent. If nothing
  // is waiting, do nothing visible (a toast would itself become a distraction).
  const jumpToNextAttention = useCallback(() => {
    const byTab = useAgentStatusStore.getState().byTab;
    const localIds = new Set(bucket.tabs.map((tab) => tab.id));
    const ordered = attentionOrder(byTab).filter((id) => localIds.has(id));
    if (ordered.length === 0) return;
    const activeIdx = bucket.activeTabId
      ? ordered.indexOf(bucket.activeTabId)
      : -1;
    const next = ordered[(activeIdx + 1) % ordered.length];
    if (next) setActiveTab(projectKey, next);
  }, [bucket.tabs, bucket.activeTabId, projectKey, setActiveTab]);

  useEffect(() => {
    (window as any).__metacodex = {
      newTerminal: handleNewTerminal,
      openFolder: handleOpenFolder,
      cloneFromGithub: handleCloneFromGithub,
      closeActiveTab,
      switchProject,
      openFile: handleOpenFile,
      sendToTerminal,
      jumpToNextAttention,
      renameActiveTab,
      moveActiveTab,
    };
    return () => {
      delete (window as any).__metacodex;
    };
  }, [
    handleNewTerminal,
    handleOpenFolder,
    handleCloneFromGithub,
    closeActiveTab,
    switchProject,
    handleOpenFile,
    sendToTerminal,
    jumpToNextAttention,
    renameActiveTab,
    moveActiveTab,
  ]);

  // CSS-grid template: the variable-width columns interpolate the current
  // settings so resizing rerenders only this style + the dragged column.
  // The right panel currently hosts Source Control only — see
  // `SourceControlPanel.tsx`.
  const gridTemplateColumns = panelOpen
    ? `56px ${explorerWidth}px minmax(0,1fr) ${sourceControlWidth}px`
    : `56px ${explorerWidth}px minmax(0,1fr)`;

  return (
    <div
      className="grid h-screen w-screen grid-rows-[36px_minmax(0,1fr)] bg-canvas text-ink"
      style={{ gridTemplateColumns }}
    >
      <TitleBar workspaceName={project?.name} className="col-span-full" />

      <MiniProjectSidebar
        onOpenFolder={handleOpenFolder}
        onCloneFromGithub={handleCloneFromGithub}
      />

      <div className="relative min-w-0">
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
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onCloseOthers={handleCloseOthers}
        onCloseAll={handleCloseAll}
        onCopyTabPath={handleCopyTabPath}
        onRevealTabInFinder={handleRevealTabInFinder}
        onCopyTabCwd={handleCopyTabCwd}
        onRenameTab={handleRenameTab}
        onMoveTab={handleMoveTab}
        onNewTerminal={handleNewTerminal}
        onLaunchCli={handleLaunchCli}
        onNewWorktree={project ? handleOpenWorktreeDialog : undefined}
        onOpenFolder={handleOpenFolder}
        onCloneFromGithub={handleCloneFromGithub}
      />

      {panelOpen ? (
        <div className="relative min-w-0">
          {project ? (
            <SourceControlPanel
              projectId={project.id}
              projectPath={project.path}
              onOpenDiff={handleOpenDiff}
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
            // Panel sits on the right edge of the window — dragging RIGHT
            // shrinks it, dragging LEFT grows it. Invert the pointer delta.
            toDelta={(dx) => -dx}
            onChange={handleSourceControlWidthChange}
            onReset={resetSourceControlWidth}
            ariaLabel={t("appShell.resizeSourceControl")}
          />
        </div>
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

      <MoveNodeConfirm
        state={pendingMove}
        skipChecked={skipMoveInSession}
        onSkipChange={setSkipMoveInSession}
        onCancel={() => setPendingMove(null)}
        onConfirm={() => {
          if (!pendingMove) return;
          const target = pendingMove;
          setPendingMove(null);
          void performMove(target.from, target.toDir);
        }}
      />

      {project ? (
        <WorktreeCreateDialog
          open={worktreeDialogOpen}
          onOpenChange={setWorktreeDialogOpen}
          projectId={project.id}
          projectPath={project.path}
          defaultBranchName=""
          defaultCliId={null}
          onAfterCreate={handleAfterWorktreeCreate}
        />
      ) : null}

      <CloneFromGithubDialog
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
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

interface MoveNodeConfirmProps {
  state: PendingMove | null;
  skipChecked: boolean;
  onSkipChange: (next: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function MoveNodeConfirm({
  state,
  skipChecked,
  onSkipChange,
  onCancel,
  onConfirm,
}: MoveNodeConfirmProps) {
  const { t } = useTranslation();
  const open = state !== null;
  const title = state ? t("appShell.moveTitle", { name: state.name }) : "";
  const description = state
    ? t("appShell.moveDescription", { toDir: state.toDir })
    : "";
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      tone="neutral"
      title={title}
      description={description}
      details={
        state ? (
          <span className="font-mono text-[11px] text-muted-soft">
            {state.from}
          </span>
        ) : null
      }
      confirmLabel={t("appShell.moveConfirm")}
      cancelLabel={t("common.cancel")}
      onConfirm={onConfirm}
      skipOption={{
        label: t("appShell.moveSkip"),
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
