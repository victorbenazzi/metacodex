import { create } from "zustand";

import { projectsApi } from "./project.service";
import type { Project } from "./project.types";

interface ProjectsState {
  projects: Project[];
  activeProjectId: string | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  add: (path: string) => Promise<Project>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<Project>;
  updateMeta: (id: string, patch: { color?: string; icon?: string }) => Promise<Project>;
  setActive: (id: string) => Promise<void>;
  clearActive: () => void;

  activeProject: () => Project | null;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  hydrated: false,

  hydrate: async () => {
    try {
      const [projects, activeId] = await Promise.all([
        projectsApi.list(),
        projectsApi.getActiveId(),
      ]);
      const stillExists =
        activeId && projects.some((p) => p.id === activeId) ? activeId : null;
      set({ projects, activeProjectId: stillExists, hydrated: true });
    } catch (err) {
      console.error("[projects] hydrate failed", err);
      set({ hydrated: true });
    }
  },

  add: async (path) => {
    const project = await projectsApi.add(path);
    const cur = get().projects;
    const next = cur.some((p) => p.id === project.id)
      ? cur.map((p) => (p.id === project.id ? project : p))
      : [...cur, project];
    set({ projects: next, activeProjectId: project.id });
    await projectsApi.setActive(project.id).catch(() => undefined);
    return project;
  },

  remove: async (id) => {
    await projectsApi.remove(id);
    const next = get().projects.filter((p) => p.id !== id);
    const activeProjectId = get().activeProjectId === id ? null : get().activeProjectId;
    set({ projects: next, activeProjectId });
  },

  rename: async (id, name) => {
    const updated = await projectsApi.rename(id, name);
    set({ projects: get().projects.map((p) => (p.id === id ? updated : p)) });
    return updated;
  },

  updateMeta: async (id, patch) => {
    const updated = await projectsApi.updateMeta(id, patch);
    set({ projects: get().projects.map((p) => (p.id === id ? updated : p)) });
    return updated;
  },

  setActive: async (id) => {
    set({ activeProjectId: id });
    await projectsApi.setActive(id).catch(() => undefined);
  },

  clearActive: () => set({ activeProjectId: null }),

  activeProject: () => {
    const { projects, activeProjectId } = get();
    return projects.find((p) => p.id === activeProjectId) ?? null;
  },
}));
