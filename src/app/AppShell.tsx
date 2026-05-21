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
import { useProjectsStore } from "@/features/projects/project.store";
import { useExplorerStore } from "@/features/explorer/explorer.store";
import {
  workspaceApi,
  type SerializedTab,
} from "@/features/projects/workspace.service";
import { watcherApi } from "@/features/filesystem/watcher.service";
import { useGitStore } from "@/features/git/git.store";
import { EV, listenTo, type FsChangedPayload } from "@/lib/events";
import { dirname } from "@/lib/path";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CMD, invoke } from "@/lib/ipc";

type PendingClose = {
  ids: string[];
  mode: "single" | "others" | "all";
  terminals: number;
  agents: number;
  /** When mode === "single", the affected tab (for personalized copy). */
  singleTab?: Tab;
};

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
  const [homeDirPath, setHomeDirPath] = useState<string | null>(null);

  // Projects store
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const hydrated = useProjectsStore((s) => s.hydrated);
  const hydrate = useProjectsStore((s) => s.hydrate);
  const addProject = useProjectsStore((s) => s.add);
  const setActive = useProjectsStore((s) => s.setActive);

  const project = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

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
  const bucket = useTabsStore((s) => s.byProject[projectKey]) ?? EMPTY_BUCKET;
  const openTab = useTabsStore((s) => s.openTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const closeMany = useTabsStore((s) => s.closeMany);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);

  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);

  const activeCwd = useMemo(
    () => project?.path ?? homeDirPath ?? "/",
    [project, homeDirPath],
  );

  const refreshGit = useGitStore((s) => s.refresh);

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
    }, 350);
    return () => clearTimeout(handle);
  }, [project, bucket.tabs, bucket.activeTabId]);

  // -- Actions ------------------------------------------------------------------
  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Open folder",
      });
      if (typeof selected === "string" && selected.length > 0) {
        await addProject(selected);
      }
    } catch (err) {
      console.error("openDialog failed", err);
    }
  }, [addProject]);

  const handleNewTerminal = useCallback(() => {
    openTab(projectKey, {
      id: `t-${newId(10)}`,
      kind: "terminal",
      title: project ? project.name : "terminal",
      projectId: project?.id ?? null,
      cwd: activeCwd,
    });
  }, [openTab, projectKey, project, activeCwd]);

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
    };
    return () => {
      delete (window as any).__metacodex;
    };
  }, [handleNewTerminal, handleOpenFolder, closeActiveTab, switchProject]);

  return (
    <div className="grid h-screen w-screen grid-rows-[36px_minmax(0,1fr)] grid-cols-[56px_248px_minmax(0,1fr)] bg-canvas text-ink">
      <TitleBar workspaceName={project?.name} className="col-span-3" />

      <MiniProjectSidebar onOpenFolder={handleOpenFolder} />

      <ExplorerPanel
        hasProject={!!project}
        projectId={project?.id}
        projectName={project?.name}
        projectPath={project?.path}
        onOpenFolder={handleOpenFolder}
        onOpenFile={handleOpenFile}
      />

      <WorkArea
        tabs={bucket.tabs}
        activeTabId={bucket.activeTabId}
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

      <CloseTabsConfirm
        state={pendingClose}
        onCancel={() => setPendingClose(null)}
        onConfirm={() => {
          if (!pendingClose) return;
          closeMany(projectKey, pendingClose.ids);
          setPendingClose(null);
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
  const open = state !== null;
  const copy = state ? confirmCopyFor(state) : null;

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
      confirmLabel={copy?.confirm ?? "Encerrar"}
      cancelLabel="Cancelar"
      onConfirm={onConfirm}
    />
  );
}

function confirmCopyFor(s: PendingClose): {
  title: string;
  description: string;
  details?: React.ReactNode;
  confirm: string;
} {
  if (s.mode === "single" && s.singleTab) {
    const t = s.singleTab;
    if (t.kind === "cli") {
      return {
        title: `Encerrar ${t.title}?`,
        description:
          "A sessão do agente está ativa. Qualquer resposta em andamento será descartada.",
        details:
          "cwd" in t && t.cwd ? (
            <span className="font-mono text-[11px] text-muted-soft">
              {t.cwd}
            </span>
          ) : null,
        confirm: "Encerrar agente",
      };
    }
    return {
      title: "Encerrar este terminal?",
      description:
        "A sessão está ativa. O processo em execução será interrompido e o histórico desta aba será perdido.",
      details:
        "cwd" in t && t.cwd ? (
          <span className="font-mono text-[11px] text-muted-soft">
            {t.cwd}
          </span>
        ) : null,
      confirm: "Encerrar terminal",
    };
  }

  const parts: string[] = [];
  if (s.terminals === 1) parts.push("1 terminal");
  else if (s.terminals > 1) parts.push(`${s.terminals} terminais`);
  if (s.agents === 1) parts.push("1 agente");
  else if (s.agents > 1) parts.push(`${s.agents} agentes`);
  const inventory = parts.join(" e ");
  const verb =
    s.terminals + s.agents === 1 ? "será interrompido" : "serão interrompidos";

  const title =
    s.mode === "all" ? "Fechar todas as abas?" : "Fechar as outras abas?";
  return {
    title,
    description: `${inventory} ${verb}. Processos em execução serão encerrados e respostas em andamento, descartadas.`,
    confirm: "Fechar todas",
  };
}
