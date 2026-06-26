import { create } from "zustand";

import { gitApi } from "./git.service";
import type { GitInfo } from "./git.types";

interface GitState {
  byProject: Record<string, GitInfo | null>;
  refresh: (projectId: string, root: string, includeStats?: boolean) => Promise<void>;
  get: (projectId: string) => GitInfo | null | undefined;
  clearProject: (projectId: string) => void;
}

export const useGitStore = create<GitState>((set, get) => ({
  byProject: {},
  refresh: async (projectId, root, includeStats = false) => {
    try {
      const info = await gitApi.status(root, includeStats);
      set((s) => {
        const prev = s.byProject[projectId];
        const next =
          info && !includeStats && prev?.stats
            ? { ...info, stats: prev.stats }
            : info;
        return { byProject: { ...s.byProject, [projectId]: next } };
      });
    } catch (err) {
      console.warn("[git] status failed", err);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: null } }));
    }
  },
  get: (projectId) => get().byProject[projectId],
  clearProject: (projectId) =>
    set((s) => {
      const { [projectId]: _, ...rest } = s.byProject;
      return { byProject: rest };
    }),
}));
