import { create } from "zustand";

interface ProjectChangesUi {
  /** Absent key means selected. Empty object means none selected. */
  unselected: Record<string, true>;
  expandedPath: string | null;
  loadedDiffs: Record<string, true>;
  message: string;
}

interface ChangesUiState {
  byProject: Record<string, ProjectChangesUi>;
  busy: boolean;
  ensure: (projectId: string) => ProjectChangesUi;
  toggleSelected: (projectId: string, path: string, currentlySelected: boolean) => void;
  selectAll: (projectId: string) => void;
  selectNone: (projectId: string, paths: string[]) => void;
  setExpanded: (projectId: string, path: string | null) => void;
  markDiffLoaded: (projectId: string, path: string) => void;
  setMessage: (projectId: string, message: string) => void;
  setBusy: (busy: boolean) => void;
  clearProject: (projectId: string) => void;
}

const EMPTY: ProjectChangesUi = {
  unselected: {},
  expandedPath: null,
  loadedDiffs: {},
  message: "",
};

function slice(state: ProjectChangesUi | undefined): ProjectChangesUi {
  return state ?? EMPTY;
}

export const useChangesUiStore = create<ChangesUiState>((set, get) => ({
  byProject: {},
  busy: false,
  ensure: (projectId) => slice(get().byProject[projectId]),
  toggleSelected: (projectId, path, currentlySelected) =>
    set((s) => {
      const cur = slice(s.byProject[projectId]);
      const unselected = { ...cur.unselected };
      if (currentlySelected) unselected[path] = true;
      else delete unselected[path];
      return {
        byProject: { ...s.byProject, [projectId]: { ...cur, unselected } },
      };
    }),
  selectAll: (projectId) =>
    set((s) => {
      const cur = slice(s.byProject[projectId]);
      return {
        byProject: { ...s.byProject, [projectId]: { ...cur, unselected: {} } },
      };
    }),
  selectNone: (projectId, paths) =>
    set((s) => {
      const cur = slice(s.byProject[projectId]);
      const unselected: Record<string, true> = { ...cur.unselected };
      for (const p of paths) unselected[p] = true;
      return {
        byProject: { ...s.byProject, [projectId]: { ...cur, unselected } },
      };
    }),
  setExpanded: (projectId, expandedPath) =>
    set((s) => {
      const cur = slice(s.byProject[projectId]);
      return {
        byProject: { ...s.byProject, [projectId]: { ...cur, expandedPath } },
      };
    }),
  markDiffLoaded: (projectId, path) =>
    set((s) => {
      const cur = slice(s.byProject[projectId]);
      return {
        byProject: {
          ...s.byProject,
          [projectId]: { ...cur, loadedDiffs: { ...cur.loadedDiffs, [path]: true } },
        },
      };
    }),
  setMessage: (projectId, message) =>
    set((s) => {
      const cur = slice(s.byProject[projectId]);
      return {
        byProject: { ...s.byProject, [projectId]: { ...cur, message } },
      };
    }),
  setBusy: (busy) => set({ busy }),
  clearProject: (projectId) =>
    set((s) => {
      const { [projectId]: _, ...rest } = s.byProject;
      return { byProject: rest };
    }),
}));

export function isPathSelected(unselected: Record<string, true>, path: string): boolean {
  return unselected[path] !== true;
}
