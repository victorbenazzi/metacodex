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
  /** Rewrite path/title of any file-backed tab affected by a rename. Tab ids
   *  STAY STABLE so editor-store entries (keyed by tabId) survive the rename. */
  remapForRename: (
    projectKey: string,
    oldPath: string,
    newPath: string,
  ) => void;
  /** Drop the bucket entirely — used when a project is removed from the app. */
  dropBucket: (projectKey: string) => void;
  getBucket: (projectKey: string) => TabsBucket;
  /** Locate an existing file-backed tab by absolute path. Used for dedup
   *  in `openTab` so the same path always focuses one tab, even after a
   *  rename has rewritten that tab's `path` (its `id` may not match). */
  findByPath: (projectKey: string, path: string) => Tab | null;
}

const emptyBucket: TabsBucket = { tabs: [], activeTabId: null };

export const useTabsStore = create<TabsState>((set, get) => ({
  byProject: {},
  openTab: (projectKey, tab, setActive = true) =>
    set((state) => {
      const cur = state.byProject[projectKey] ?? emptyBucket;
      // Dedup strategy:
      //  1) If `tab` has a `path`, prefer matching by path — covers the case
      //     where a tab was renamed (its `id` is now decoupled from the new
      //     path, but the tab still represents that file).
      //  2) Otherwise fall back to id-based dedup for terminals / non-file tabs.
      const tabPath = "path" in tab ? (tab as { path?: string }).path : undefined;
      let existingIdx = -1;
      if (tabPath) {
        existingIdx = cur.tabs.findIndex(
          (t) => "path" in t && (t as { path?: string }).path === tabPath,
        );
      }
      if (existingIdx < 0) {
        existingIdx = cur.tabs.findIndex((t) => t.id === tab.id);
      }
      const existing = existingIdx >= 0 ? cur.tabs[existingIdx] : null;
      const nextTabs = existing ? cur.tabs : [...cur.tabs, tab];
      const focusId = existing ? existing.id : tab.id;
      return {
        byProject: {
          ...state.byProject,
          [projectKey]: {
            tabs: nextTabs,
            activeTabId: setActive ? focusId : cur.activeTabId ?? focusId,
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
      const nextTabs = cur.tabs.map((t) => {
        if (!("path" in t) || !t.path) return t;
        // The `+ "/"` guard prevents prefix collisions: "/foo" must not match
        // "/foobar/x.ts" — only "/foo" itself or "/foo/<child>".
        if (t.path !== oldPath && !t.path.startsWith(oldPath + "/")) return t;
        changed = true;
        const remapped = newPath + t.path.slice(oldPath.length);
        // Keep `id` stable — the editor store (keyed by tabId) follows the
        // rename automatically because its key never changes. The path-based
        // dedup in `openTab` handles re-opening the same file by its new path.
        return { ...t, path: remapped, title: basename(remapped) } as Tab;
      });
      if (!changed) return state;
      return {
        byProject: {
          ...state.byProject,
          [projectKey]: { tabs: nextTabs, activeTabId: cur.activeTabId },
        },
      };
    }),

  dropBucket: (projectKey) =>
    set((state) => {
      if (!(projectKey in state.byProject)) return state;
      const { [projectKey]: _, ...rest } = state.byProject;
      return { byProject: rest };
    }),

  getBucket: (projectKey) => get().byProject[projectKey] ?? emptyBucket,

  findByPath: (projectKey, path) => {
    const cur = get().byProject[projectKey];
    if (!cur) return null;
    return (
      cur.tabs.find(
        (t) => "path" in t && (t as { path?: string }).path === path,
      ) ?? null
    );
  },
}));
