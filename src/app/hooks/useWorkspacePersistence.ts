import { useCallback, useEffect, useRef } from "react";

import type { Project } from "@/features/projects/project.types";
import { useTabsStore, type TabsBucket } from "@/components/tabs/tabsStore";
import type { Tab } from "@/components/tabs/types";
import {
  workspaceApi,
  type SerializedTab,
  type WorkspaceSaveResult,
} from "@/features/projects/workspace.service";
import { useExplorerStore } from "@/features/explorer/explorer.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { recordDiag } from "@/features/diagnostics/diagnostics.store";
import { useSidePanelStore } from "@/features/side-panel/sidePanel.store";

type HydrationStatus = "pending" | "loaded" | "failed";

let quitFlusher: (() => Promise<void>) | null = null;

interface RevisionState {
  revision: number;
  dirty: boolean;
  inFlight: Promise<void> | null;
}

export class WorkspaceRevisionQueue {
  private readonly projects = new Map<string, RevisionState>();

  hydrate(projectId: string, revision: number): void {
    this.projects.set(projectId, { revision, dirty: false, inFlight: null });
  }

  markDirty(projectId: string): number {
    const current = this.projects.get(projectId) ?? {
      revision: 0,
      dirty: false,
      inFlight: null,
    };
    current.revision += 1;
    current.dirty = true;
    this.projects.set(projectId, current);
    return current.revision;
  }

  isDirty(projectId: string): boolean {
    return this.projects.get(projectId)?.dirty ?? false;
  }

  async save(
    projectId: string,
    saveRevision: (revision: number) => Promise<WorkspaceSaveResult>,
  ): Promise<void> {
    const current = this.projects.get(projectId);
    if (!current?.dirty) return;
    const revision = current.revision;
    const previous = current.inFlight;
    const operation = (async () => {
      if (previous) await previous.catch(() => undefined);
      const result = await saveRevision(revision);
      const latest = this.projects.get(projectId);
      if (!latest) return;
      if (result.status === "stale") {
        latest.revision = Math.max(latest.revision, result.acceptedRevision + 1);
        latest.dirty = true;
      } else if (latest.revision <= result.revision) {
        latest.dirty = false;
      }
    })();
    current.inFlight = operation;
    try {
      await operation;
    } finally {
      const latest = this.projects.get(projectId);
      if (latest?.inFlight === operation) latest.inFlight = null;
    }
  }

  async flush(
    projectId: string,
    saveRevision: (revision: number) => Promise<WorkspaceSaveResult>,
  ): Promise<void> {
    const existing = this.projects.get(projectId)?.inFlight;
    if (existing) await existing.catch(() => undefined);
    while (this.isDirty(projectId)) {
      await this.save(projectId, saveRevision);
    }
  }
}

export async function flushLoadedWorkspacesForQuit(): Promise<void> {
  if (quitFlusher) await quitFlusher();
}

export function useWorkspacePersistence(
  project: Project | null,
  projects: Project[],
  bucket: TabsBucket,
): void {
  const hydrationStatus = useRef<Map<string, HydrationStatus>>(new Map());
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const revisions = useRef(new WorkspaceRevisionQueue());

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
        revisions.current.hydrate(projectId, ws?.revision ?? 0);
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
          if (ws.activeTabId) {
            useSidePanelStore.getState().focusDoc(ws.activeTabId);
          }
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

  const performWorkspaceSave = useCallback(async (projectId: string, revision: number) => {
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
    const docId = useSidePanelStore.getState().activeDocId;
    const persistedActiveId =
      docId && persistTabs.some((t) => t.id === docId)
        ? docId
        : persistTabs[0]?.id ?? null;
    try {
      const result = await workspaceApi.save(projectId, revision, {
        openTabs: persistTabs,
        activeTabId: persistedActiveId,
        expandedPaths,
      });
      recordDiag("workspace.save.ok", {
        projectId,
        detail: { tabs: persistTabs.length, revision, status: result.status },
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordDiag("workspace.save.fail", {
        projectId,
        detail: { error: message, revision, retryOutcome: "pending" },
      });
      console.warn("[workspace] save failed", err);
      throw err;
    }
  }, []);

  useEffect(() => {
    const flush = async () => {
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      saveTimers.current.clear();
      const loadedProjects = Array.from(hydrationStatus.current.entries())
        .filter(([, status]) => status === "loaded")
        .map(([id]) => id);
      await Promise.all(loadedProjects.map((pid) =>
        revisions.current.flush(pid, (revision) => performWorkspaceSave(pid, revision))
      ));
      recordDiag("app.before_quit", {
        detail: { savedCount: loadedProjects.length },
      });
    };
    quitFlusher = flush;
    return () => {
      if (quitFlusher === flush) quitFlusher = null;
    };
  }, [performWorkspaceSave]);

  useEffect(() => {
    if (!project) return;
    if (hydrationStatus.current.get(project.id) !== "loaded") return;
    const projectId = project.id;
    revisions.current.markDirty(projectId);
    const saveDebounceMs =
      useSettingsDataStore.getState().settings.performance.workspaceSaveDebounceMs;
    const prev = saveTimers.current.get(projectId);
    if (prev) clearTimeout(prev);
    const handle = setTimeout(() => {
      saveTimers.current.delete(projectId);
      void revisions.current
        .save(projectId, (revision) => performWorkspaceSave(projectId, revision))
        .catch(() => undefined);
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
        void revisions.current
          .save(projectId, (revision) => performWorkspaceSave(projectId, revision))
          .catch(() => undefined);
      }
    };
  }, [project, performWorkspaceSave]);
}
