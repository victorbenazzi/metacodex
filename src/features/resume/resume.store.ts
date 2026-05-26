import { create } from "zustand";

import { resumeApi, type ResumeEntry } from "./resume.service";

interface ResumeState {
  entries: ResumeEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  save: (entry: Omit<ResumeEntry, "id" | "capturedAt" | "lastSeenAt">) => Promise<void>;
  discard: (id: string) => Promise<void>;
  recent: (days?: number) => ResumeEntry[];
  forProject: (projectId: string) => ResumeEntry[];
}

export const useResumeStore = create<ResumeState>((set, get) => ({
  entries: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const entries = await resumeApi.list(null, 30);
      set({ entries, hydrated: true });
    } catch (err) {
      console.warn("[resume] hydrate failed", err);
      set({ hydrated: true });
    }
  },

  refresh: async () => {
    try {
      const entries = await resumeApi.list(null, 30);
      set({ entries });
    } catch (err) {
      console.warn("[resume] refresh failed", err);
    }
  },

  save: async (entry) => {
    await resumeApi.save(entry);
    await get().refresh();
  },

  discard: async (id) => {
    await resumeApi.discard(id);
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
  },

  recent: (days = 7) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return get().entries.filter((e) => {
      const t = Date.parse(e.lastSeenAt);
      return !Number.isNaN(t) && t >= cutoff;
    });
  },

  forProject: (projectId) => get().entries.filter((e) => e.projectId === projectId),
}));
