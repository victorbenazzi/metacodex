import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useTranslation } from "react-i18next";

import type { Tab } from "@/components/tabs/types";
import { fileKindFor } from "@/components/tabs/fileKind";
import { WORKSPACE_NULL, useTabsStore, type TabsBucket } from "@/components/tabs/tabsStore";
import type { Project } from "@/features/projects/project.types";
import { useProjectsStore } from "@/features/projects/project.store";
import { useExplorerStore } from "@/features/explorer/explorer.store";
import { flushEditor } from "@/features/editor/editorSavers";
import { fsApi } from "@/features/filesystem/filesystem.service";
import { CMD, invoke } from "@/lib/ipc";
import { EV, listenTo, type OpenFilePayload, type PreviewGrant } from "@/lib/events";
import { basename } from "@/lib/path";
import { newId } from "@/lib/idGen";
import { cliLaunchString, type CliTool } from "@/features/terminal/cli-registry";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { ptyApi } from "@/features/terminal/terminal.service";
import { utf8ToBase64 } from "@/lib/base64";
import {
  attentionOrder,
  useAgentStatusStore,
} from "@/features/terminal/agent-status.store";
import type { SentToProject } from "@/components/previews/SendToProjectDialog";
import type { AppCommands } from "@/app/appCommands";
import {
  looksLikeFile,
  processSummary,
  type PendingClose,
} from "@/app/appShell.helpers";

interface UseTabActionsParams {
  project: Project | null;
  projects: Project[];
  projectKey: string;
  bucket: TabsBucket;
  activeCwd: string;
  pendingClose: PendingClose | null;
  setPendingClose: Dispatch<SetStateAction<PendingClose | null>>;
  setWorktreeDialogOpen: Dispatch<SetStateAction<boolean>>;
  setCloneDialogOpen: Dispatch<SetStateAction<boolean>>;
  setSendToProjectFile: Dispatch<SetStateAction<PreviewGrant | null>>;
  setDropActive: Dispatch<SetStateAction<boolean>>;
}

export interface TabActions extends AppCommands {
  launchCli: (cli: CliTool) => void;
  openWorktreeDialog: () => void;
  afterWorktreeCreate: (result: { branch: string; path: string }) => void;
  closeTab: (tabId: string) => void;
  closeOthers: (keepId: string) => void;
  closeAll: () => void;
  selectTab: (tabId: string) => void;
  copyTabPath: (tabId: string) => void;
  revealTabInFinder: (tabId: string) => void;
  copyTabCwd: (tabId: string) => void;
  renameTab: (tabId: string, newTitle: string) => void;
  moveTab: (tabId: string, toIndex: number) => void;
  openInTerminal: (path: string, name: string) => void;
  launchCliInPath: (cli: CliTool, path: string, name: string) => void;
  openDiff: (path: string, status: string) => void;
  sentToProject: (payload: SentToProject) => void;
  confirmPendingClose: () => void;
}

export function useTabActions({
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
}: UseTabActionsParams): TabActions {
  const { t } = useTranslation();
  const addProject = useProjectsStore((s) => s.add);
  const setActive = useProjectsStore((s) => s.setActive);
  const openTab = useTabsStore((s) => s.openTab);
  const closeTabStore = useTabsStore((s) => s.closeTab);
  const closeMany = useTabsStore((s) => s.closeMany);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);
  const moveTabStore = useTabsStore((s) => s.moveTab);
  const setTabTitles = useTabsStore((s) => s.setTabTitles);
  const setEditingTabId = useTabsStore((s) => s.setEditingTabId);

  const openFolder = useCallback(async () => {
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

  const cloneFromGithub = useCallback(() => {
    setCloneDialogOpen(true);
  }, [setCloneDialogOpen]);

  const newTerminal = useCallback(() => {
    openTab(projectKey, {
      id: `t-${newId(10)}`,
      kind: "terminal",
      title: project ? project.name : "terminal",
      projectId: project?.id ?? null,
      cwd: activeCwd,
    });
  }, [openTab, projectKey, project, activeCwd]);

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
        if (session.tabId) setActiveTab(projectKey, session.tabId);
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

  const launchCli = useCallback(
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

  const openWorktreeDialog = useCallback(() => {
    if (!project) return;
    setWorktreeDialogOpen(true);
  }, [project, setWorktreeDialogOpen]);

  const afterWorktreeCreate = useCallback(
    ({ branch, path }: { branch: string; path: string }) => {
      setWorktreeDialogOpen(false);
      if (!project) return;
      openTab(projectKey, {
        id: `t-${newId(10)}`,
        kind: "terminal",
        title: branch,
        projectId: project.id,
        cwd: path,
      });
    },
    [openTab, projectKey, project, setWorktreeDialogOpen],
  );

  const requestClose = useCallback(
    (mode: PendingClose["mode"], targets: Tab[], singleTab?: Tab) => {
      const ids = targets.map((tab) => tab.id);
      if (ids.length === 0) return;
      const { terminals, agents } = processSummary(targets);
      if (terminals === 0 && agents === 0) {
        closeMany(projectKey, ids);
        return;
      }
      setPendingClose({ ids, mode, terminals, agents, singleTab });
    },
    [closeMany, projectKey, setPendingClose],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const target = bucket.tabs.find((tab) => tab.id === tabId);
      if (!target) return;
      if (target.kind === "terminal" || target.kind === "cli") {
        requestClose("single", [target], target);
      } else {
        closeTabStore(projectKey, tabId);
      }
    },
    [bucket.tabs, closeTabStore, projectKey, requestClose],
  );

  const closeOthers = useCallback(
    (keepId: string) => {
      const targets = bucket.tabs.filter((tab) => tab.id !== keepId);
      requestClose("others", targets);
    },
    [bucket.tabs, requestClose],
  );

  const closeAll = useCallback(() => {
    requestClose("all", bucket.tabs);
  }, [bucket.tabs, requestClose]);

  const selectTab = useCallback(
    (tabId: string) => setActiveTab(projectKey, tabId),
    [setActiveTab, projectKey],
  );

  const copyTabPath = useCallback(
    (tabId: string) => {
      const tab = bucket.tabs.find((t) => t.id === tabId);
      if (!tab || !("path" in tab) || !tab.path) return;
      navigator.clipboard.writeText(tab.path).catch((err) => {
        console.warn("[clipboard] copy path failed", err);
      });
    },
    [bucket.tabs],
  );

  const revealTabInFinder = useCallback(
    (tabId: string) => {
      const tab = bucket.tabs.find((t) => t.id === tabId);
      if (!tab || !("path" in tab) || !tab.path) return;
      invoke(CMD.revealInFinder, { path: tab.path }).catch((err) => {
        console.warn("[reveal_in_finder] failed", err);
      });
    },
    [bucket.tabs],
  );

  const copyTabCwd = useCallback(
    (tabId: string) => {
      const tab = bucket.tabs.find((t) => t.id === tabId);
      if (!tab || !("cwd" in tab) || !tab.cwd) return;
      navigator.clipboard.writeText(tab.cwd).catch((err) => {
        console.warn("[clipboard] copy cwd failed", err);
      });
    },
    [bucket.tabs],
  );

  const renameTab = useCallback(
    (tabId: string, newTitle: string) => {
      const trimmed = newTitle.trim();
      const next = trimmed ? trimmed.slice(0, 60) : null;
      setTabTitles(projectKey, tabId, { userTitle: next });
    },
    [setTabTitles, projectKey],
  );

  const moveTab = useCallback(
    (tabId: string, toIndex: number) => {
      moveTabStore(projectKey, tabId, toIndex);
    },
    [moveTabStore, projectKey],
  );

  const renameActiveTab = useCallback(() => {
    const id = bucket.activeTabId;
    if (!id) return;
    const tab = bucket.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.kind !== "terminal" && tab.kind !== "cli") return;
    setEditingTabId(id);
  }, [bucket.activeTabId, bucket.tabs, setEditingTabId]);

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

  const activateAdjacentTab = useCallback(
    (delta: -1 | 1) => {
      const n = bucket.tabs.length;
      if (n < 2) return;
      const idx = bucket.activeTabId
        ? bucket.tabs.findIndex((t) => t.id === bucket.activeTabId)
        : -1;
      const base = idx < 0 ? (delta === 1 ? -1 : 0) : idx;
      const next = ((base + delta) % n + n) % n;
      setActiveTab(projectKey, bucket.tabs[next].id);
    },
    [bucket.activeTabId, bucket.tabs, projectKey, setActiveTab],
  );

  const openInTerminal = useCallback(
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

  const launchCliInPath = useCallback(
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

  const openFile = useCallback(
    (path: string, name: string, openInEditMode?: boolean) => {
      if (!project) return;
      const id = `f-${path}`;
      const kind = fileKindFor(name);
      let tab: Tab;
      if (kind === "markdown") {
        tab = {
          id,
          kind: "markdown",
          title: name,
          projectId: project.id,
          path,
          mode: openInEditMode ? "source" : "preview",
        };
      } else if (kind === "image") {
        tab = { id, kind: "image", title: name, projectId: project.id, path };
      } else if (kind === "pdf") {
        tab = { id, kind: "pdf", title: name, projectId: project.id, path };
      } else {
        tab = { id, kind: "editor", title: name, projectId: project.id, path };
      }
      openTab(projectKey, tab);
    },
    [openTab, projectKey, project],
  );

  const openPreviewFile = useCallback(
    (file: PreviewGrant) => {
      const { path, grantId } = file;
      const name = basename(path);
      const id = `pf-${path}`;
      const kind = fileKindFor(name);
      const base = { id, title: name, projectId: null, path, previewGrantId: grantId } as const;
      let tab: Tab;
      if (kind === "markdown") {
        tab = { ...base, kind: "markdown", mode: "preview" };
      } else if (kind === "image") {
        tab = { ...base, kind: "image" };
      } else if (kind === "pdf") {
        tab = { ...base, kind: "pdf" };
      } else {
        tab = { ...base, kind: "editor" };
      }
      openTab(projectKey, tab);
    },
    [openTab, projectKey],
  );

  const pickPreviewFile = useCallback(async () => {
    try {
      const selected = await fsApi.pickPreviewFile(t("preview.openTitle"));
      if (selected) openPreviewFile(selected);
    } catch (err) {
      console.error("preview openDialog failed", err);
    }
  }, [openPreviewFile, t]);

  const sendToProject = useCallback(
    async (file: PreviewGrant) => {
      await flushEditor(`pf-${file.path}`).catch(() => undefined);
      setSendToProjectFile(file);
    },
    [setSendToProjectFile],
  );

  const sentToProject = useCallback(
    ({ project: dest, oldPath, newPath, toDir }: SentToProject) => {
      const previewId = `pf-${oldPath}`;
      const buckets = useTabsStore.getState().byProject;
      for (const [key, b] of Object.entries(buckets)) {
        if (b.tabs.some((tb) => tb.id === previewId)) {
          closeTabStore(key, previewId);
        }
      }
      const name = basename(newPath);
      const fid = `f-${newPath}`;
      const kind = fileKindFor(name);
      let tab: Tab;
      if (kind === "markdown") {
        tab = { id: fid, kind: "markdown", title: name, projectId: dest.id, path: newPath, mode: "preview" };
      } else if (kind === "image") {
        tab = { id: fid, kind: "image", title: name, projectId: dest.id, path: newPath };
      } else if (kind === "pdf") {
        tab = { id: fid, kind: "pdf", title: name, projectId: dest.id, path: newPath };
      } else {
        tab = { id: fid, kind: "editor", title: name, projectId: dest.id, path: newPath };
      }
      openTab(dest.id, tab);
      void setActive(dest.id);
      void useExplorerStore.getState().refresh(dest.id, toDir);
    },
    [closeTabStore, openTab, setActive],
  );

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      off = await listenTo<OpenFilePayload>(EV.openFile, (e) => {
        for (const file of e.payload.files) openPreviewFile(file);
      });
      if (cancelled) {
        off?.();
        return;
      }
      try {
        const pending = await invoke<PreviewGrant[]>(CMD.takePendingOpenFiles);
        for (const file of pending) openPreviewFile(file);
      } catch {
        // nothing queued
      }
    })();
    return () => {
      cancelled = true;
      off?.();
    };
  }, [openPreviewFile]);

  useEffect(() => {
    let un: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDropActive(true);
        } else if (payload.type === "drop") {
          setDropActive(false);
          for (const path of payload.paths) {
            if (!looksLikeFile(path)) void addProject(path).catch(() => undefined);
          }
        } else {
          setDropActive(false);
        }
      });
      if (cancelled) {
        unlisten();
        return;
      }
      un = unlisten;
    })();
    return () => {
      cancelled = true;
      un?.();
    };
  }, [addProject, setDropActive]);

  const openDiff = useCallback(
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
    closeTab(bucket.activeTabId);
  }, [bucket.activeTabId, closeTab]);

  const switchProject = useCallback(
    (n: number) => {
      const target = projects[n - 1];
      if (target) void setActive(target.id);
    },
    [projects, setActive],
  );

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

  const confirmPendingClose = useCallback(() => {
    if (!pendingClose) return;
    closeMany(projectKey, pendingClose.ids);
    setPendingClose(null);
  }, [closeMany, pendingClose, projectKey, setPendingClose]);

  return useMemo(
    () => ({
      newTerminal,
      openFolder,
      cloneFromGithub,
      closeActiveTab,
      switchProject,
      openFile,
      pickPreviewFile,
      sendToProject,
      sendToTerminal,
      jumpToNextAttention,
      renameActiveTab,
      moveActiveTab,
      activateAdjacentTab,
      launchCli,
      openWorktreeDialog,
      afterWorktreeCreate,
      closeTab,
      closeOthers,
      closeAll,
      selectTab,
      copyTabPath,
      revealTabInFinder,
      copyTabCwd,
      renameTab,
      moveTab,
      openInTerminal,
      launchCliInPath,
      openDiff,
      sentToProject,
      confirmPendingClose,
    }),
    [
      newTerminal,
      openFolder,
      cloneFromGithub,
      closeActiveTab,
      switchProject,
      openFile,
      pickPreviewFile,
      sendToProject,
      sendToTerminal,
      jumpToNextAttention,
      renameActiveTab,
      moveActiveTab,
      activateAdjacentTab,
      launchCli,
      openWorktreeDialog,
      afterWorktreeCreate,
      closeTab,
      closeOthers,
      closeAll,
      selectTab,
      copyTabPath,
      revealTabInFinder,
      copyTabCwd,
      renameTab,
      moveTab,
      openInTerminal,
      launchCliInPath,
      openDiff,
      sentToProject,
      confirmPendingClose,
    ],
  );
}
