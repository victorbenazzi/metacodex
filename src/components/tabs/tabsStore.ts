import { create } from "zustand";
import type { Tab } from "./types";
import { basename } from "@/lib/path";

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
  closeMany: (projectKey: string, tabIds: string[]) => void;
  setActiveTab: (projectKey: string, tabId: string) => void;
  updateTab: (projectKey: string, tabId: string, patch: Partial<Tab>) => void;
  /** Close any file-backed tab whose path === removedPath or sits inside it. */
  closeForRemovedPath: (projectKey: string, removedPath: string) => void;
  /** Rewrite path/title/id of any file-backed tab affected by a rename. */
  remapForRename: (
    projectKey: string,
    oldPath: string,
    newPath: string,
  ) => void;
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
  closeMany: (projectKey, tabIds) =>
    set((state) => {
      const cur = state.byProject[projectKey];
      if (!cur || tabIds.length === 0) return state;
      const killSet = new Set(tabIds);
      const nextTabs = cur.tabs.filter((t) => !killSet.has(t.id));
      let activeTabId = cur.activeTabId;
      if (activeTabId && killSet.has(activeTabId)) {
        // Pick the nearest surviving tab — search forward from the dead tab's
        // original position, then backward; fallback to last remaining.
        const oldIdx = cur.tabs.findIndex((t) => t.id === activeTabId);
        const forward = cur.tabs
          .slice(oldIdx + 1)
          .find((t) => !killSet.has(t.id));
        const backward = cur.tabs
          .slice(0, oldIdx)
          .reverse()
          .find((t) => !killSet.has(t.id));
        activeTabId = forward?.id ?? backward?.id ?? nextTabs[0]?.id ?? null;
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
  closeForRemovedPath: (projectKey, removedPath) =>
    set((state) => {
      const cur = state.byProject[projectKey];
      if (!cur) return state;
      const kill = new Set<string>();
      for (const t of cur.tabs) {
        if (!("path" in t) || !t.path) continue;
        if (t.path === removedPath || t.path.startsWith(removedPath + "/")) {
          kill.add(t.id);
        }
      }
      if (kill.size === 0) return state;
      const nextTabs = cur.tabs.filter((t) => !kill.has(t.id));
      let activeTabId = cur.activeTabId;
      if (activeTabId && kill.has(activeTabId)) {
        const oldIdx = cur.tabs.findIndex((t) => t.id === activeTabId);
        const forward = cur.tabs.slice(oldIdx + 1).find((t) => !kill.has(t.id));
        const backward = cur.tabs
          .slice(0, oldIdx)
          .reverse()
          .find((t) => !kill.has(t.id));
        activeTabId = forward?.id ?? backward?.id ?? nextTabs[0]?.id ?? null;
      }
      return {
        byProject: {
          ...state.byProject,
          [projectKey]: { tabs: nextTabs, activeTabId },
        },
      };
    }),

  remapForRename: (projectKey, oldPath, newPath) =>
    set((state) => {
      const cur = state.byProject[projectKey];
      if (!cur) return state;
      let changed = false;
      let nextActiveId = cur.activeTabId;
      const nextTabs = cur.tabs.map((t) => {
        if (!("path" in t) || !t.path) return t;
        if (t.path !== oldPath && !t.path.startsWith(oldPath + "/")) return t;
        changed = true;
        const remapped = newPath + t.path.slice(oldPath.length);
        const oldId = t.id;
        const newId = oldId.startsWith("f-") ? `f-${remapped}` : oldId;
        if (cur.activeTabId === oldId) nextActiveId = newId;
        return { ...t, id: newId, path: remapped, title: basename(remapped) } as Tab;
      });
      if (!changed) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectKey]: { tabs: nextTabs, activeTabId: nextActiveId },
        },
      };
    }),

  getBucket: (projectKey) => get().byProject[projectKey] ?? emptyBucket,
}));
