import { create } from "zustand";

/**
 * Left-sidebar UI state:
 *  - `collapsed` hides the agent sidebar entirely (Cursor-style; no icon rail).
 *  - `expandedProjects` stores per-project thread expansion in RepoRow.
 * Persisted to localStorage, same first-paint pattern as `theme.store`.
 * Kept out of settings.json since it is ephemeral chrome state.
 */
interface CodeSidebarState {
  collapsed: boolean;
  /** Explicit per-project expansion. Absent means the repo row stays folded. */
  expandedProjects: Record<string, boolean>;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  setProjectExpanded: (id: string, expanded: boolean) => void;
}

const KEY = "metacodex:codeSidebar";

interface Persisted {
  collapsed: boolean;
  expandedProjects: Record<string, boolean>;
}

function readStored(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Persisted>;
      return {
        collapsed: v.collapsed === true,
        expandedProjects:
          v.expandedProjects && typeof v.expandedProjects === "object" ? v.expandedProjects : {},
      };
    }
  } catch {
    // localStorage may be unavailable; fall through to defaults
  }
  return { collapsed: false, expandedProjects: {} };
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
      expandedProjects: get().expandedProjects,
    });

  return {
    collapsed: initial.collapsed,
    expandedProjects: initial.expandedProjects,
    setCollapsed: (collapsed) => {
      set({ collapsed });
      persist();
    },
    toggleCollapsed: () => {
      set({ collapsed: !get().collapsed });
      persist();
    },
    setProjectExpanded: (id, expanded) => {
      set({ expandedProjects: { ...get().expandedProjects, [id]: expanded } });
      persist();
    },
  };
});
