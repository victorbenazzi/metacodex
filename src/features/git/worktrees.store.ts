import { create } from "zustand";

import { worktreesApi, type MergeStrategy, type WorktreeInfo } from "./worktrees.service";

interface ProjectWorktrees {
  worktrees: WorktreeInfo[];
  loading: boolean;
  error?: string;
  lastFetchedAt?: number;
}

interface WorktreesState {
  byProject: Record<string, ProjectWorktrees>;
  /** Map of absolute worktree path → tabIds currently running in it.
   *  Maintained externally via `recomputeOccupancy`. */
  occupancyByPath: Record<string, string[]>;
  refresh: (projectId: string, root: string) => Promise<void>;
  add: (
    projectId: string,
    root: string,
    branchName: string,
    baseRef?: string,
  ) => Promise<WorktreeInfo>;
  remove: (
    projectId: string,
    root: string,
    worktreePath: string,
    force?: boolean,
  ) => Promise<void>;
  merge: (
    projectId: string,
    root: string,
    branch: string,
    strategy: MergeStrategy,
  ) => Promise<void>;
  setOccupancy: (next: Record<string, string[]>) => void;
}

export const useWorktreesStore = create<WorktreesState>((set, get) => ({
  byProject: {},
  occupancyByPath: {},

  refresh: async (projectId, root) => {
    set((s) => ({
      byProject: {
        ...s.byProject,
        [projectId]: {
          worktrees: s.byProject[projectId]?.worktrees ?? [],
          loading: true,
        },
      },
    }));
    try {
      const worktrees = await worktreesApi.list(root);
      set((s) => ({
        byProject: {
          ...s.byProject,
          [projectId]: {
            worktrees,
            loading: false,
            lastFetchedAt: Date.now(),
          },
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        byProject: {
          ...s.byProject,
          [projectId]: {
            worktrees: s.byProject[projectId]?.worktrees ?? [],
            loading: false,
            error: message,
          },
        },
      }));
    }
  },

  add: async (projectId, root, branchName, baseRef) => {
    const created = await worktreesApi.add(root, branchName, { baseRef });
    // Optimistic update + truth-refresh.
    set((s) => ({
      byProject: {
        ...s.byProject,
        [projectId]: {
          worktrees: [...(s.byProject[projectId]?.worktrees ?? []), created],
          loading: s.byProject[projectId]?.loading ?? false,
        },
      },
    }));
    void get().refresh(projectId, root);
    return created;
  },

  remove: async (projectId, root, worktreePath, force = false) => {
    await worktreesApi.remove(root, worktreePath, force);
    await get().refresh(projectId, root);
  },

  merge: async (projectId, root, branch, strategy) => {
    await worktreesApi.merge(root, branch, strategy);
    await get().refresh(projectId, root);
  },

  setOccupancy: (next) => set({ occupancyByPath: next }),
}));
