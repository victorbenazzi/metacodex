import { create } from "zustand";

import { gitApi } from "./git.service";
import type { GitInfo } from "./git.types";

interface GitState {
  byProject: Record<string, GitInfo | null>;
  refresh: (projectId: string, root: string, includeStats?: boolean) => Promise<void>;
  get: (projectId: string) => GitInfo | null | undefined;
  clearProject: (projectId: string) => void;
}

interface RefreshRequest {
  revision: number;
  root: string;
  includeStats: boolean;
}

const revisions = new Map<string, number>();
const queued = new Map<string, RefreshRequest>();
const inflight = new Map<string, Promise<void>>();

export const useGitStore = create<GitState>((set, get) => ({
  byProject: {},
  refresh: async (projectId, root, includeStats = false) => {
    const revision = (revisions.get(projectId) ?? 0) + 1;
    revisions.set(projectId, revision);
    queued.set(projectId, { revision, root, includeStats });
    const existing = inflight.get(projectId);
    if (existing) return existing;
    const operation = (async () => {
      while (queued.has(projectId)) {
        const request = queued.get(projectId)!;
        queued.delete(projectId);
        try {
          const info = await gitApi.status(request.root, request.includeStats);
          if (revisions.get(projectId) !== request.revision) continue;
          set((s) => {
            const prev = s.byProject[projectId];
            const next = info && !request.includeStats && prev?.stats
              ? { ...info, stats: prev.stats }
              : info;
            return { byProject: { ...s.byProject, [projectId]: next } };
          });
        } catch (err) {
          console.warn("[git] status failed", err);
          if (revisions.get(projectId) === request.revision) {
            set((s) => ({ byProject: { ...s.byProject, [projectId]: null } }));
          }
        }
      }
    })();
    inflight.set(projectId, operation);
    try {
      await operation;
    } finally {
      if (inflight.get(projectId) === operation) inflight.delete(projectId);
    }
  },
  get: (projectId) => get().byProject[projectId],
  clearProject: (projectId) =>
    set((s) => {
      const { [projectId]: _, ...rest } = s.byProject;
      revisions.delete(projectId);
      queued.delete(projectId);
      return { byProject: rest };
    }),
}));
