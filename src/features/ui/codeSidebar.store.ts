import { create } from "zustand";

/**
 * Left-sidebar UI state, shared by both top-level views:
 *  - `collapsed`       -> the Code projects sidebar (rail vs expanded);
 *  - `agentCollapsed`  -> the Agent sidebar (shown vs hidden);
 *  - `expandedProjects`-> per-project expansion in the Code expanded sidebar.
 * The title-bar toggle flips whichever sidebar matches the active view.
 * Persisted to localStorage (synchronous first-paint, same pattern as
 * `theme.store`/`view.store`); kept out of settings.json since it is ephemeral
 * chrome state.
 */
interface CodeSidebarState {
  collapsed: boolean;
  agentCollapsed: boolean;
  /** Explicit per-project expansion. Absent -> derive from "is active project". */
  expandedProjects: Record<string, boolean>;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  toggleAgentCollapsed: () => void;
  setProjectExpanded: (id: string, expanded: boolean) => void;
}

const KEY = "metacodex:codeSidebar";

interface Persisted {
  collapsed: boolean;
  agentCollapsed: boolean;
  expandedProjects: Record<string, boolean>;
}

function readStored(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Persisted>;
      return {
        collapsed: v.collapsed === true,
        agentCollapsed: v.agentCollapsed === true,
        expandedProjects:
          v.expandedProjects && typeof v.expandedProjects === "object" ? v.expandedProjects : {},
      };
    }
  } catch {
    // localStorage may be unavailable; fall through to defaults
  }
  return { collapsed: false, agentCollapsed: false, expandedProjects: {} };
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
      agentCollapsed: get().agentCollapsed,
      expandedProjects: get().expandedProjects,
    });

  return {
    collapsed: initial.collapsed,
    agentCollapsed: initial.agentCollapsed,
    expandedProjects: initial.expandedProjects,
    setCollapsed: (collapsed) => {
      set({ collapsed });
      persist();
    },
    toggleCollapsed: () => {
      set({ collapsed: !get().collapsed });
      persist();
    },
    toggleAgentCollapsed: () => {
      set({ agentCollapsed: !get().agentCollapsed });
      persist();
    },
    setProjectExpanded: (id, expanded) => {
      set({ expandedProjects: { ...get().expandedProjects, [id]: expanded } });
      persist();
    },
  };
});
