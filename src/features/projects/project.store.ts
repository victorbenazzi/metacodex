import { create } from "zustand";

import { projectsApi } from "./project.service";
import type { Project } from "./project.types";
import { useTabsStore } from "@/components/tabs/tabsStore";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { ptyApi } from "@/features/terminal/terminal.service";
import { useExplorerStore } from "@/features/explorer/explorer.store";
import { useGitStore } from "@/features/git/git.store";
import { watcherApi } from "@/features/filesystem/watcher.service";

interface ProjectsState {
  projects: Project[];
  activeProjectId: string | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  add: (path: string) => Promise<Project>;
  addRemote: (accessId: string, path: string, name?: string) => Promise<Project>;
  create: (directory: string, name: string) => Promise<Project>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<Project>;
  updateMeta: (id: string, patch: { color?: string; icon?: string }) => Promise<Project>;
  reorder: (orderedIds: string[]) => Promise<void>;
  setActive: (id: string) => Promise<void>;
  clearActive: () => void;

  activeProject: () => Project | null;
}

/**
 * Merge a freshly added/created project into the list and make it active. Shared
 * by `add` (existing folder) and `create` (new folder) so the registration
 * bookkeeping lives in one place.
 */
async function absorbProject(
  get: () => ProjectsState,
  set: (partial: Partial<ProjectsState>) => void,
  project: Project,
): Promise<Project> {
  const cur = get().projects;
  const next = cur.some((p) => p.id === project.id)
    ? cur.map((p) => (p.id === project.id ? project : p))
    : [...cur, project];
  set({ projects: next, activeProjectId: project.id });
  await projectsApi.setActive(project.id).catch(() => undefined);
  return project;
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

  add: (path) => projectsApi.add(path).then((p) => absorbProject(get, set, p)),
  addRemote: (accessId, path, name) =>
    projectsApi.addRemote(accessId, path, name).then((p) => absorbProject(get, set, p)),
  create: (directory, name) =>
    projectsApi.create(directory, name).then((p) => absorbProject(get, set, p)),

  remove: async (id) => {
    // Tear down every live resource attached to this project BEFORE the Rust
    // registry forgets it — otherwise leaked PTYs keep emitting pty://data
    // for a project the UI no longer knows about, and the next click on a
    // sibling project lands on stale tab/terminal state (the "stuck after
    // remove" bug).
    const tabs = useTabsStore.getState();
    const bucket = tabs.byProject[id];
    if (bucket) {
      const sessions = useTerminalStore.getState().sessions;
      for (const tab of bucket.tabs) {
        if (tab.kind !== "terminal" && tab.kind !== "cli") continue;
        // Find any PTY session bound to this tab and kill it in Rust.
        for (const s of Object.values(sessions)) {
          if (s.tabId === tab.id) {
            void ptyApi.kill(s.id).catch(() => undefined);
            useTerminalStore.getState().remove(s.id);
          }
        }
      }
      tabs.dropBucket(id);
    }
    // Drop any per-project caches/refs the rest of the app keeps.
    useExplorerStore.getState().clearProject(id);
    useGitStore.getState().clearProject(id);
    void watcherApi.unwatch(id).catch(() => undefined);

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

  reorder: async (orderedIds) => {
    // Optimistic local reorder so the rail snaps instantly while the IPC round-trips.
    const cur = get().projects;
    const byId = new Map(cur.map((p) => [p.id, p] as const));
    const next: Project[] = [];
    for (const id of orderedIds) {
      const p = byId.get(id);
      if (p) next.push(p);
    }
    if (next.length !== cur.length) {
      // Mismatch — abort the local reorder; backend would reject anyway.
      return;
    }
    set({ projects: next });
    try {
      const persisted = await projectsApi.reorder(orderedIds);
      set({ projects: persisted });
    } catch (err) {
      console.error("[projects] reorder failed, rolling back", err);
      set({ projects: cur });
    }
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
