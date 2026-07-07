import { create } from "zustand";

/**
 * Left-sidebar UI state:
 *  - `collapsed` maps to the projects sidebar, rail vs expanded.
 *  - `explorerCollapsed` folds the file-explorer column to zero width.
 *  - `expandedProjects` stores per-project expansion in the expanded sidebar.
 * Persisted to localStorage, same first-paint pattern as `theme.store`.
 * Kept out of settings.json since it is ephemeral
 * chrome state.
 */
interface CodeSidebarState {
  collapsed: boolean;
  explorerCollapsed: boolean;
  /** Explicit per-project expansion. Absent means derive from active project. */
  expandedProjects: Record<string, boolean>;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  setExplorerCollapsed: (collapsed: boolean) => void;
  toggleExplorerCollapsed: () => void;
  setProjectExpanded: (id: string, expanded: boolean) => void;
}

const KEY = "metacodex:codeSidebar";

interface Persisted {
  collapsed: boolean;
  explorerCollapsed: boolean;
  expandedProjects: Record<string, boolean>;
}

function readStored(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Persisted>;
      return {
        collapsed: v.collapsed === true,
        explorerCollapsed: v.explorerCollapsed === true,
        expandedProjects:
          v.expandedProjects && typeof v.expandedProjects === "object" ? v.expandedProjects : {},
      };
    }
  } catch {
    // localStorage may be unavailable; fall through to defaults
  }
  return { collapsed: false, explorerCollapsed: false, expandedProjects: {} };
}

function writeStored(state: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const initial = readStored();

export const useCodeSidebarStore = create<CodeSidebarState>((set, get) => {
  const persist = () =>
    writeStored({
      collapsed: get().collapsed,
      explorerCollapsed: get().explorerCollapsed,
      expandedProjects: get().expandedProjects,
    });

  return {
    collapsed: initial.collapsed,
    explorerCollapsed: initial.explorerCollapsed,
    expandedProjects: initial.expandedProjects,
    setCollapsed: (collapsed) => {
      set({ collapsed });
      persist();
    },
    toggleCollapsed: () => {
      set({ collapsed: !get().collapsed });
      persist();
    },
    setExplorerCollapsed: (explorerCollapsed) => {
      set({ explorerCollapsed });
      persist();
    },
    toggleExplorerCollapsed: () => {
      set({ explorerCollapsed: !get().explorerCollapsed });
      persist();
    },
    setProjectExpanded: (id, expanded) => {
      set({ expandedProjects: { ...get().expandedProjects, [id]: expanded } });
      persist();
    },
  };
});
