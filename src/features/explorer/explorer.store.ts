import { create } from "zustand";

import { fsApi } from "@/features/filesystem/filesystem.service";
import type { DirEntry } from "@/features/filesystem/filesystem.types";

export type ChildrenState = DirEntry[] | "loading" | { error: string };

interface ExplorerBucket {
  /** Folder paths currently expanded. */
  expanded: Set<string>;
  /** Cached children by absolute folder path. */
  children: Record<string, ChildrenState>;
}

interface ExplorerState {
  byProject: Record<string, ExplorerBucket>;
  getBucket: (projectId: string) => ExplorerBucket;
  toggleExpand: (projectId: string, path: string) => Promise<void>;
  loadIfNeeded: (projectId: string, path: string) => Promise<void>;
  refresh: (projectId: string, path: string) => Promise<void>;
  clearProject: (projectId: string) => void;
}

const emptyBucket = (): ExplorerBucket => ({
  expanded: new Set<string>(),
  children: {},
});

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  byProject: {},

  getBucket: (projectId) => get().byProject[projectId] ?? emptyBucket(),

  toggleExpand: async (projectId, path) => {
    const cur = get().byProject[projectId] ?? emptyBucket();
    const next = new Set(cur.expanded);
    const wasExpanded = next.has(path);
    if (wasExpanded) {
      next.delete(path);
    } else {
      next.add(path);
    }
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: { ...cur, expanded: next },
      },
    }));
    if (!wasExpanded && !cur.children[path]) {
      await get().loadIfNeeded(projectId, path);
    }
  },

  loadIfNeeded: async (projectId, path) => {
    const cur = get().byProject[projectId] ?? emptyBucket();
    if (cur.children[path]) return;
    // Mark loading
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: {
          ...cur,
          children: { ...cur.children, [path]: "loading" },
        },
      },
    }));
    try {
      const entries = await fsApi.readDir(path);
      set((state) => {
        const b = state.byProject[projectId] ?? emptyBucket();
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
              ...b,
              children: { ...b.children, [path]: entries },
            },
          },
        };
      });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      set((state) => {
        const b = state.byProject[projectId] ?? emptyBucket();
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
              ...b,
              children: { ...b.children, [path]: { error: message } },
            },
          },
        };
      });
    }
  },

  refresh: async (projectId, path) => {
    const cur = get().byProject[projectId] ?? emptyBucket();
    const nextChildren = { ...cur.children };
    delete nextChildren[path];
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: { ...cur, children: nextChildren },
      },
    }));
    await get().loadIfNeeded(projectId, path);
  },

  clearProject: (projectId) =>
    set((state) => {
      const { [projectId]: _, ...rest } = state.byProject;
      return { byProject: rest };
    }),
}));
