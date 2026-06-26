import { create } from "zustand";
import type { Tab } from "./types";
import { basename } from "@/lib/path";

/**
 * Tabs are keyed by project. Use `WORKSPACE_NULL` as the bucket for "no project
 * yet" , Day 1 the user can open terminal tabs before adding any project.
 */
export const WORKSPACE_NULL = "__no_project__";

interface TabsBucket {
  tabs: Tab[];
  activeTabId: string | null;
}

interface TabsState {
  byProject: Record<string, TabsBucket>;
  /** Id of the tab currently in inline-rename edit mode (across all projects ,
   *  only one input can be active at a time). Null when no edit is in progress. */
  editingTabId: string | null;
  openTab: (projectKey: string, tab: Tab, setActive?: boolean) => void;
  closeTab: (projectKey: string, tabId: string) => void;
  closeMany: (projectKey: string, tabIds: string[]) => void;
  setActiveTab: (projectKey: string, tabId: string) => void;
  updateTab: (projectKey: string, tabId: string, patch: Partial<Tab>) => void;
  /** Reorder a single tab to a new index within its project bucket. No-op if
   *  the move is invalid or doesn't change the order. Preserves `activeTabId`. */
  moveTab: (projectKey: string, tabId: string, toIndex: number) => void;
  /** Patch title overrides on a tab. Passing `userTitle: ""` or `userTitle: null`
   *  clears the manual rename (title falls back to agentTitle / default). Same
   *  contract for `agentTitle`. */
  setTabTitles: (
    projectKey: string,
    tabId: string,
    patch: { agentTitle?: string | null; userTitle?: string | null },
  ) => void;
  /** Enter / exit inline rename mode for a tab. Pass null to exit. */
  setEditingTabId: (tabId: string | null) => void;
  /** Close any file-backed tab whose path === removedPath or sits inside it. */
  closeForRemovedPath: (projectKey: string, removedPath: string) => void;
  /** Rewrite path/title of any file-backed tab affected by a rename. Tab ids
   *  STAY STABLE so editor-store entries (keyed by tabId) survive the rename. */
  remapForRename: (
    projectKey: string,
    oldPath: string,
    newPath: string,
  ) => void;
  /** Drop the bucket entirely , used when a project is removed from the app. */
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
  editingTabId: null,
  openTab: (projectKey, tab, setActive = true) =>
    set((state) => {
      const cur = state.byProject[projectKey] ?? emptyBucket;
      // Dedup strategy:
      //  1) If `tab` has a `path`, match by path , BUT scoped to the same tab
      //     family. A diff tab and an editor tab can point at the same file and
      //     must stay independent (opening the diff of an already-open file must
      //     not just focus the editor, and vice-versa). `path` is the identity
      //     for file tabs, so we do NOT fall back to id-dedup for them (a stale
      //     post-rename id could otherwise steal focus from a new same-name file).
      //  2) Tabs without a path (terminals / CLIs) dedup by id only.
      const tabPath = "path" in tab ? (tab as { path?: string }).path : undefined;
      const isDiff = tab.kind === "diff";
      let existingIdx = -1;
      if (tabPath) {
        existingIdx = cur.tabs.findIndex(
          (t) =>
            "path" in t &&
            (t as { path?: string }).path === tabPath &&
            (t.kind === "diff") === isDiff,
        );
      } else {
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
        // Clear inline-edit if the tab being closed was the one in edit mode.
        editingTabId: state.editingTabId === tabId ? null : state.editingTabId,
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
        // Pick the nearest surviving tab , search forward from the dead tab's
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
        editingTabId:
          state.editingTabId && killSet.has(state.editingTabId)
            ? null
            : state.editingTabId,
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
      const idx = cur.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;
      const current = cur.tabs[idx];
      let changed = false;
      for (const [key, value] of Object.entries(patch)) {
        if ((current as any)[key] !== value) {
          changed = true;
          break;
        }
      }
      if (!changed) return state;
      const nextTabs = cur.tabs.slice();
      nextTabs[idx] = { ...current, ...patch } as Tab;
      return {
        byProject: {
          ...state.byProject,
          [projectKey]: {
            ...cur,
            tabs: nextTabs,
          },
        },
      };
    }),
  moveTab: (projectKey, tabId, toIndex) =>
    set((state) => {
      const cur = state.byProject[projectKey];
      if (!cur) return state;
      const fromIdx = cur.tabs.findIndex((t) => t.id === tabId);
      if (fromIdx === -1) return state;
      // Clamp + early-exit when the move is a no-op. Note: target index is
      // expressed in the ORIGINAL array , after removing `from`, an index
      // greater than `from` shifts down by one. We normalize first.
      const clamped = Math.max(0, Math.min(cur.tabs.length - 1, toIndex));
      if (clamped === fromIdx) return state;
      const next = cur.tabs.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(clamped, 0, moved);
      return {
        byProject: {
          ...state.byProject,
          [projectKey]: { tabs: next, activeTabId: cur.activeTabId },
        },
      };
    }),

  setTabTitles: (projectKey, tabId, patch) =>
    set((state) => {
      const cur = state.byProject[projectKey];
      if (!cur) return state;
      const idx = cur.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;
      const tab = cur.tabs[idx];
      // Build the next tab, removing the override fields entirely when the
      // caller passes `null` or empty string. Storing `undefined` keeps the
      // override absent (vs. set-to-empty-string, which would lock the title
      // blank).
      const nextAgent =
        patch.agentTitle === null || patch.agentTitle === ""
          ? undefined
          : patch.agentTitle !== undefined
            ? patch.agentTitle
            : tab.agentTitle;
      const nextUser =
        patch.userTitle === null || patch.userTitle === ""
          ? undefined
          : patch.userTitle !== undefined
            ? patch.userTitle
            : tab.userTitle;
      if (nextAgent === tab.agentTitle && nextUser === tab.userTitle) {
        return state;
      }
      const nextTab = { ...tab, agentTitle: nextAgent, userTitle: nextUser } as Tab;
      const nextTabs = cur.tabs.slice();
      nextTabs[idx] = nextTab;
      return {
        byProject: {
          ...state.byProject,
          [projectKey]: { tabs: nextTabs, activeTabId: cur.activeTabId },
        },
      };
    }),

  setEditingTabId: (tabId) =>
    set((state) => (state.editingTabId === tabId ? state : { editingTabId: tabId })),

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
        editingTabId:
          state.editingTabId && kill.has(state.editingTabId)
            ? null
            : state.editingTabId,
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
        // "/foobar/x.ts" , only "/foo" itself or "/foo/<child>".
        if (t.path !== oldPath && !t.path.startsWith(oldPath + "/")) return t;
        changed = true;
        const remapped = newPath + t.path.slice(oldPath.length);
        // Keep `id` stable , the editor store (keyed by tabId) follows the
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
      const { [projectKey]: removed, ...rest } = state.byProject;
      const editingDied =
        state.editingTabId != null &&
        removed.tabs.some((t) => t.id === state.editingTabId);
      return {
        byProject: rest,
        editingTabId: editingDied ? null : state.editingTabId,
      };
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
