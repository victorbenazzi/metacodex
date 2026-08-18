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

import { WORKSPACE_NULL, useTabsStore, type TabsBucket } from "@/components/tabs/tabsStore";
import type { Project } from "@/features/projects/project.types";
import { useProjectsStore } from "@/features/projects/project.store";
import { flushEditor } from "@/features/editor/editorSavers";
import { fsApi } from "@/features/filesystem/filesystem.service";
import { CMD, invoke } from "@/lib/ipc";
import { EV, listenTo, type OpenFilePayload, type PreviewGrant } from "@/lib/events";
import type { CliTool } from "@/features/terminal/cli-registry";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { ptyApi } from "@/features/terminal/terminal.service";
import { utf8ToBase64 } from "@/lib/base64";
import {
  attentionOrder,
  useAgentStatusStore,
} from "@/features/terminal/agent-status.store";
import type { SentToProject } from "@/components/previews/SendToProjectDialog";
import type { AppCommands } from "@/app/appCommands";
import { looksLikeFile } from "@/app/appShell.helpers";
import { basename } from "@/lib/path";
import { useSidePanelStore } from "@/features/side-panel/sidePanel.store";
import { useChangesUiStore } from "@/features/git/changes.store";
import {
  cancelPendingClose,
  confirmPendingClose as lifecycleConfirmPendingClose,
  isProcessTab,
  isWorkbenchDocTab,
  openAfterSentToProject,
  openCli,
  openDiffInProject,
  openFileInProject,
  openPreview,
  openTerminal,
  requestCloseTab,
  requestCloseTabs,
} from "@/features/tabs";
import type { RightWorkbenchTab } from "@/features/side-panel/sidePanel.store";

interface UseTabActionsParams {
  project: Project | null;
  projects: Project[];
  projectKey: string;
  bucket: TabsBucket;
  activeCwd: string;
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
  openChanges: (expandPath?: string) => void;
  sentToProject: (payload: SentToProject) => void;
  confirmPendingClose: () => void;
}

/**
 * React adapter: dialogs, AppCommands shape, and gesture wiring.
 * Tab open/close policy lives in Tab lifecycle (`@/features/tabs`).
 */
export function useTabActions({
  project,
  projects,
  projectKey,
  bucket,
  activeCwd,
  setWorktreeDialogOpen,
  setCloneDialogOpen,
  setSendToProjectFile,
  setDropActive,
}: UseTabActionsParams): TabActions {
  const { t } = useTranslation();
  const addProject = useProjectsStore((s) => s.add);
  const setActive = useProjectsStore((s) => s.setActive);
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
    openTerminal({
      projectKey,
      projectId: project?.id ?? null,
      cwd: activeCwd,
      title: project ? project.name : "terminal",
    });
  }, [projectKey, project, activeCwd]);

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
        openTerminal({
          projectKey,
          projectId: project?.id ?? null,
          cwd: activeCwd,
          title: project ? project.name : "terminal",
          prefillCommand: payload,
        });
      }
    },
    [setActiveTab, projectKey, project, activeCwd],
  );

  const launchCli = useCallback(
    (cli: CliTool) => {
      openCli({
        projectKey,
        projectId: project?.id ?? null,
        cwd: activeCwd,
        cli,
      });
    },
    [projectKey, project, activeCwd],
  );

  const openWorktreeDialog = useCallback(() => {
    if (!project) return;
    setWorktreeDialogOpen(true);
  }, [project, setWorktreeDialogOpen]);

  const afterWorktreeCreate = useCallback(
    ({ branch, path }: { branch: string; path: string }) => {
      setWorktreeDialogOpen(false);
      if (!project) return;
      openTerminal({
        projectKey,
        projectId: project.id,
        cwd: path,
        title: branch,
      });
    },
    [projectKey, project, setWorktreeDialogOpen],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      requestCloseTab(projectKey, tabId);
    },
    [projectKey],
  );

  const closeOthers = useCallback(
    (keepId: string) => {
      const targets = bucket.tabs.filter((tab) => tab.id !== keepId);
      requestCloseTabs(projectKey, "others", targets);
    },
    [bucket.tabs, projectKey],
  );

  const closeAll = useCallback(() => {
    requestCloseTabs(projectKey, "all", bucket.tabs);
  }, [bucket.tabs, projectKey]);

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
    const processes = bucket.tabs.filter(isProcessTab);
    const id =
      processes.find((tab) => tab.id === bucket.activeTabId)?.id ??
      processes[0]?.id;
    if (!id) return;
    setEditingTabId(id);
  }, [bucket.activeTabId, bucket.tabs, setEditingTabId]);

  const moveActiveTab = useCallback(
    (delta: -1 | 1) => {
      const panel = useSidePanelStore.getState();
      if (panel.view !== "closed") {
        if (panel.focus === "doc") {
          const docs = bucket.tabs.filter(isWorkbenchDocTab);
          const id =
            docs.find((tab) => tab.id === panel.activeDocId)?.id ??
            docs.find((tab) => tab.id === bucket.activeTabId)?.id;
          if (!id) return;
          const idx = docs.findIndex((tab) => tab.id === id);
          const next = idx + delta;
          if (next < 0 || next >= docs.length) return;
          const target = bucket.tabs.findIndex((tab) => tab.id === docs[next].id);
          if (target >= 0) moveTabStore(projectKey, id, target);
          return;
        }
        const from = panel.openTabs.indexOf(panel.view);
        if (from < 0) return;
        const next = from + delta;
        if (next < 0 || next >= panel.openTabs.length) return;
        panel.moveTab(panel.view, next);
        return;
      }
      const processes = bucket.tabs.filter(isProcessTab);
      const id =
        processes.find((tab) => tab.id === bucket.activeTabId)?.id ??
        processes[0]?.id;
      if (!id) return;
      const idx = processes.findIndex((tab) => tab.id === id);
      const next = idx + delta;
      if (next < 0 || next >= processes.length) return;
      const target = bucket.tabs.findIndex((tab) => tab.id === processes[next].id);
      if (target >= 0) moveTabStore(projectKey, id, target);
    },
    [bucket.activeTabId, bucket.tabs, moveTabStore, projectKey],
  );

  const activateAdjacentTab = useCallback(
    (delta: -1 | 1) => {
      const panel = useSidePanelStore.getState();
      if (panel.view !== "closed") {
        type Item =
          | { type: "surface"; id: RightWorkbenchTab }
          | { type: "doc"; id: string };
        const docs = bucket.tabs.filter(isWorkbenchDocTab);
        const items: Item[] = [
          ...panel.openTabs.map((id) => ({ type: "surface" as const, id })),
          ...docs.map((tab) => ({ type: "doc" as const, id: tab.id })),
        ];
        if (items.length < 2) return;
        const current =
          panel.focus === "doc" && panel.activeDocId
            ? `doc:${panel.activeDocId}`
            : `surface:${panel.view}`;
        const keys = items.map((item) =>
          item.type === "surface" ? `surface:${item.id}` : `doc:${item.id}`,
        );
        const idx = keys.indexOf(current);
        const base = idx < 0 ? (delta === 1 ? -1 : 0) : idx;
        const next = ((base + delta) % items.length + items.length) % items.length;
        const item = items[next];
        if (item.type === "surface") {
          panel.show(item.id);
        } else {
          panel.focusDoc(item.id);
          setActiveTab(projectKey, item.id);
        }
        return;
      }
      const processes = bucket.tabs.filter(isProcessTab);
      const n = processes.length;
      if (n < 2) return;
      const idx = bucket.activeTabId
        ? processes.findIndex((tab) => tab.id === bucket.activeTabId)
        : -1;
      const base = idx < 0 ? (delta === 1 ? -1 : 0) : idx;
      const next = ((base + delta) % n + n) % n;
      setActiveTab(projectKey, processes[next].id);
    },
    [bucket.activeTabId, bucket.tabs, projectKey, setActiveTab],
  );

  const openInTerminal = useCallback(
    (path: string, name: string) => {
      openTerminal({
        projectKey,
        projectId: project?.id ?? null,
        cwd: path,
        title: name || basename(path),
      });
    },
    [projectKey, project],
  );

  const launchCliInPath = useCallback(
    (cli: CliTool, path: string, name: string) => {
      openCli({
        projectKey,
        projectId: project?.id ?? null,
        cwd: path,
        cli,
        title: `${cli.label} · ${name || basename(path)}`,
      });
    },
    [projectKey, project],
  );

  const openFile = useCallback(
    (path: string, name: string, openInEditMode?: boolean) => {
      if (!project) return;
      const id = openFileInProject(project, path, name, openInEditMode);
      useSidePanelStore.getState().focusDoc(id);
    },
    [project],
  );

  const pickPreviewFile = useCallback(async () => {
    try {
      const selected = await fsApi.pickPreviewFile(t("preview.openTitle"));
      if (selected) {
        const id = openPreview(projectKey, selected);
        useSidePanelStore.getState().focusDoc(id);
      }
    } catch (err) {
      console.error("preview openDialog failed", err);
    }
  }, [projectKey, t]);

  const sendToProject = useCallback(
    async (file: PreviewGrant) => {
      await flushEditor(`pf-${file.path}`).catch(() => undefined);
      setSendToProjectFile(file);
    },
    [setSendToProjectFile],
  );

  const sentToProject = useCallback(({ project: dest, oldPath, newPath, toDir }: SentToProject) => {
    const id = openAfterSentToProject({ dest, oldPath, newPath, toDir });
    useSidePanelStore.getState().focusDoc(id);
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      off = await listenTo<OpenFilePayload>(EV.openFile, (e) => {
        for (const file of e.payload.files) {
          const id = openPreview(projectKey, file);
          useSidePanelStore.getState().focusDoc(id);
        }
      });
      if (cancelled) {
        off?.();
        return;
      }
      try {
        const pending = await invoke<PreviewGrant[]>(CMD.takePendingOpenFiles);
        for (const file of pending) {
          const id = openPreview(projectKey, file);
          useSidePanelStore.getState().focusDoc(id);
        }
      } catch {
        // nothing queued
      }
    })();
    return () => {
      cancelled = true;
      off?.();
    };
  }, [projectKey]);

  useEffect(() => {
    let un: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
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
      } catch {
        // Webview APIs are missing outside a Tauri window (or during HMR).
      }
    })();
    return () => {
      cancelled = true;
      un?.();
    };
  }, [addProject, setDropActive]);

  useEffect(() => {
    const leftover = bucket.tabs.filter((tab) => tab.kind === "changes");
    if (leftover.length > 0) {
      useTabsStore.getState().closeMany(
        projectKey,
        leftover.map((tab) => tab.id),
      );
    }
  }, [bucket.tabs, projectKey]);

  useEffect(() => {
    const docs = bucket.tabs.filter(isWorkbenchDocTab);
    const { activeDocId, focus } = useSidePanelStore.getState();
    if (activeDocId && docs.some((tab) => tab.id === activeDocId)) return;
    const fallback = docs[0]?.id ?? null;
    if (fallback) {
      useSidePanelStore.setState({ activeDocId: fallback });
      return;
    }
    if (activeDocId != null || focus === "doc") {
      useSidePanelStore.setState({
        activeDocId: null,
        ...(focus === "doc" ? { focus: "surface" as const } : {}),
      });
    }
  }, [bucket.tabs]);

  const openDiff = useCallback(
    (path: string, status: string) => {
      if (!project) return;
      const id = openDiffInProject({ project, path, status });
      useSidePanelStore.getState().focusDoc(id);
    },
    [project],
  );

  const openChanges = useCallback(
    (expandPath?: string) => {
      if (!project) return;
      useSidePanelStore.getState().show("changes");
      if (expandPath) {
        useChangesUiStore.getState().setExpanded(project.id, expandPath);
      }
    },
    [project],
  );

  const closeActiveTab = useCallback(() => {
    const panel = useSidePanelStore.getState();
    if (panel.view !== "closed") {
      if (panel.focus === "doc") {
        const docs = bucket.tabs.filter(isWorkbenchDocTab);
        const id =
          docs.find((tab) => tab.id === panel.activeDocId)?.id ??
          docs.find((tab) => tab.id === bucket.activeTabId)?.id ??
          docs[0]?.id;
        if (id) closeTab(id);
        return;
      }
      panel.closeTab(panel.view);
      return;
    }
    const processes = bucket.tabs.filter(isProcessTab);
    const id =
      processes.find((tab) => tab.id === bucket.activeTabId)?.id ??
      processes[0]?.id;
    if (id) closeTab(id);
  }, [bucket.activeTabId, bucket.tabs, closeTab]);

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
    void lifecycleConfirmPendingClose();
  }, []);

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
      openChanges,
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
      openChanges,
      sentToProject,
      confirmPendingClose,
    ],
  );
}

// Keep cancel available for AppShell without going through actions.
export { cancelPendingClose };
