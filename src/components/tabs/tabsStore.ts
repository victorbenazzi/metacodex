import { create } from "zustand";
import type { Tab } from "./types";

/**
 * Tabs are keyed by project. Use `WORKSPACE_NULL` as the bucket for "no project
 * yet" — Day 1 the user can open terminal tabs before adding any project.
 */
export const WORKSPACE_NULL = "__no_project__";

interface TabsBucket {
  tabs: Tab[];
  activeTabId: string | null;
}

interface TabsState {
  byProject: Record<string, TabsBucket>;
  openTab: (projectKey: string, tab: Tab, setActive?: boolean) => void;
  closeTab: (projectKey: string, tabId: string) => void;
  setActiveTab: (projectKey: string, tabId: string) => void;
  updateTab: (projectKey: string, tabId: string, patch: Partial<Tab>) => void;
  getBucket: (projectKey: string) => TabsBucket;
}

const emptyBucket: TabsBucket = { tabs: [], activeTabId: null };

export const useTabsStore = create<TabsState>((set, get) => ({
  byProject: {},
  openTab: (projectKey, tab, setActive = true) =>
    set((state) => {
      const cur = state.byProject[projectKey] ?? emptyBucket;
      // Avoid duplicates of file-path tabs by ID; terminals have unique IDs.
      const existingIdx = cur.tabs.findIndex((t) => t.id === tab.id);
      const nextTabs =
        existingIdx >= 0 ? cur.tabs : [...cur.tabs, tab];
      return {
        byProject: {
          ...state.byProject,
          [projectKey]: {
            tabs: nextTabs,
            activeTabId: setActive ? tab.id : cur.activeTabId ?? tab.id,
          },
        },
      };
    }),
  closeTab: (projectKey, tabId) =>
    set((state) => {
      const cur = state.byProject[projectKey];
      if (!cur) return state;
      const nextTabs = cur.tabs.filter((t) => t.id !== tabId);
      let activeTabId = cur.activeTabId;
      if (activeTabId === tabId) {
        const idx = cur.tabs.findIndex((t) => t.id === tabId);
        const fallback = nextTabs[idx] ?? nextTabs[idx - 1] ?? nextTabs[nextTabs.length - 1] ?? null;
        activeTabId = fallback?.id ?? null;
      }
      return {
        byProject: {
          ...state.byProject,
          [projectKey]: { tabs: nextTabs, activeTabId },
        },
      };
    }),
  setActiveTab: (projectKey, tabId) =>
    set((state) => {
      const cur = state.byProject[projectKey];
      if (!cur) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectKey]: { ...cur, activeTabId: tabId },
        },
      };
    }),
  updateTab: (projectKey, tabId, patch) =>
    set((state) => {
      const cur = state.byProject[projectKey];
      if (!cur) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectKey]: {
            ...cur,
            tabs: cur.tabs.map((t) =>
              t.id === tabId ? ({ ...t, ...patch } as Tab) : t,
            ),
          },
        },
      };
    }),
  getBucket: (projectKey) => get().byProject[projectKey] ?? emptyBucket,
}));
