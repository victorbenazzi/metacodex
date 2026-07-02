import { useCallback, useEffect, useRef } from "react";

import type { Project } from "@/features/projects/project.types";
import { useTabsStore, type TabsBucket } from "@/components/tabs/tabsStore";
import type { Tab } from "@/components/tabs/types";
import {
  workspaceApi,
  type SerializedTab,
} from "@/features/projects/workspace.service";
import { useExplorerStore } from "@/features/explorer/explorer.store";
import { useSettingsDataStore, flushSettings } from "@/features/settings/settings.data.store";
import { flushAllEditors } from "@/features/editor/editorSavers";
import { useSaveStatusStore } from "@/features/workspace/saveStatus.store";
import { EV, listenTo } from "@/lib/events";
import { CMD, invoke } from "@/lib/ipc";
import { recordDiag, useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";

type HydrationStatus = "pending" | "loaded" | "failed";

export function useWorkspacePersistence(
  project: Project | null,
  projects: Project[],
  bucket: TabsBucket,
): void {
  const hydrationStatus = useRef<Map<string, HydrationStatus>>(new Map());
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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
        hydrationStatus.current.set(projectId, "loaded");
      } catch (err) {
        hydrationStatus.current.set(projectId, "failed");
        recordDiag("workspace.load.fail", {
          projectId,
          detail: { error: err instanceof Error ? err.message : String(err) },
        });
        console.warn("[workspace] load failed", err);
      }
    })();
  }, [project]);

  const performWorkspaceSave = useCallback(async (projectId: string) => {
    const cur = useTabsStore.getState().byProject[projectId];
    const explorerBucket = useExplorerStore.getState().byProject[projectId];
    const expandedPaths = explorerBucket ? Array.from(explorerBucket.expanded) : [];
    const persistTabs: SerializedTab[] = (cur?.tabs ?? [])
      .map((t): SerializedTab | null => {
        if (t.projectId == null) return null;
        if (t.kind === "markdown") {
          return { id: t.id, kind: "markdown", title: t.title, path: t.path, mode: t.mode };
        }
        if (t.kind === "editor" || t.kind === "image" || t.kind === "pdf") {
          return { id: t.id, kind: t.kind, title: t.title, path: t.path };
        }
        return null;
      })
      .filter((t): t is SerializedTab => t !== null);
    const persistedActiveId =
      cur?.activeTabId && persistTabs.some((t) => t.id === cur.activeTabId)
        ? cur.activeTabId
        : persistTabs[0]?.id ?? null;
    useSaveStatusStore.getState().beginSave();
    try {
      await workspaceApi.save(projectId, {
        openTabs: persistTabs,
        activeTabId: persistedActiveId,
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const off = await listenTo<unknown>(EV.beforeQuit, async () => {
        await Promise.all([flushAllEditors(), flushSettings()]);
        for (const timer of saveTimers.current.values()) clearTimeout(timer);
        saveTimers.current.clear();
        const loadedProjects = Array.from(hydrationStatus.current.entries())
          .filter(([, status]) => status === "loaded")
          .map(([id]) => id);
        await Promise.all(loadedProjects.map((pid) => performWorkspaceSave(pid)));
        recordDiag("app.before_quit", {
          detail: { savedCount: loadedProjects.length },
        });
        try {
          await invoke(CMD.diagWriteSessionLog, {
            payload: useDiagnosticsStore.getState().serialize(),
          });
        } catch {
          // ignore, disk dump is observability, not load-bearing
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
    const saveDebounceMs =
      useSettingsDataStore.getState().settings.performance.workspaceSaveDebounceMs;
    const prev = saveTimers.current.get(projectId);
    if (prev) clearTimeout(prev);
    const handle = setTimeout(() => {
      saveTimers.current.delete(projectId);
      void performWorkspaceSave(projectId);
    }, saveDebounceMs);
    saveTimers.current.set(projectId, handle);
  }, [project, bucket.tabs, bucket.activeTabId, performWorkspaceSave]);

  useEffect(() => {
    if (!project) return;
    const projectId = project.id;
    return () => {
      const pending = saveTimers.current.get(projectId);
      if (pending) {
        clearTimeout(pending);
        saveTimers.current.delete(projectId);
        void performWorkspaceSave(projectId);
      }
    };
  }, [project, performWorkspaceSave]);
}
