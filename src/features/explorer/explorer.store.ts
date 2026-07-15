import { create } from "zustand";

import { fsApi } from "@/features/filesystem/filesystem.service";
import type { DirEntry } from "@/features/filesystem/filesystem.types";

export type ChildrenState = DirEntry[] | "loading" | { error: string };

export type CreateKind = "file" | "dir";

export interface SelectedNode {
  path: string;
  isDir: boolean;
}

export interface CreatingState {
  /** Directory the new node will be created inside. */
  parentPath: string;
  kind: CreateKind;
}

interface ExplorerBucket {
  /** Folder paths currently expanded. */
  expanded: Set<string>;
  /** Cached children by absolute folder path. */
  children: Record<string, ChildrenState>;
  /** Currently selected node (drives where New File/Folder lands). */
  selected: SelectedNode | null;
  /** In-progress inline create, if any. */
  creating: CreatingState | null;
  /**
   * Absolute paths of entries that appeared in a directory listing since the
   * previous refresh , used to tint "just-appeared" files (typically created
   * by the IA running in the terminal). Value is the Date.now() timestamp
   * when the entry was first observed; auto-cleared after RECENT_TTL_MS.
   */
  recentlyAdded: Record<string, number>;
}

/** How long a newly-appeared entry keeps its tint. Matches the
 *  `explorer-recent-tint` keyframe duration (15s) in `src/styles/tokens.css`. */
export const RECENT_TTL_MS = 15_000;

interface ExplorerState {
  byProject: Record<string, ExplorerBucket>;
  getBucket: (projectId: string) => ExplorerBucket;
  toggleExpand: (projectId: string, path: string) => Promise<void>;
  loadIfNeeded: (projectId: string, path: string) => Promise<void>;
  refresh: (projectId: string, path: string) => Promise<void>;
  clearProject: (projectId: string) => void;
  /** Set (or clear) the selected node for a project. */
  setSelected: (projectId: string, selected: SelectedNode | null) => void;
  /** Open an inline create input inside `parentPath` (expands it first). */
  beginCreate: (
    projectId: string,
    parentPath: string,
    kind: CreateKind,
  ) => Promise<void>;
  /** Dismiss the inline create input without creating anything. */
  cancelCreate: (projectId: string) => void;
  /** Create a file or directory inside `parentPath`. Returns the new path. */
  createNode: (
    projectId: string,
    parentPath: string,
    name: string,
    kind: CreateKind,
  ) => Promise<string>;
  /** Drop a path from the recentlyAdded map (called by the TTL timer). */
  clearRecent: (projectId: string, path: string) => void;
}

const emptyBucket = (): ExplorerBucket => ({
  expanded: new Set<string>(),
  children: {},
  selected: null,
  creating: null,
  recentlyAdded: {},
});

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  byProject: {},

  getBucket: (projectId) => get().byProject[projectId] ?? emptyBucket(),

  toggleExpand: async (projectId, path) => {
    const cur = get().byProject[projectId] ?? emptyBucket();
    const next = new Set(cur.expanded);
    const wasExpanded = next.has(path);
    if (wasExpanded) {
      next.delete(path);
    } else {
      next.add(path);
    }
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: { ...cur, expanded: next },
      },
    }));
    if (!wasExpanded && !cur.children[path]) {
      await get().loadIfNeeded(projectId, path);
    }
  },

  loadIfNeeded: async (projectId, path) => {
    const cur = get().byProject[projectId] ?? emptyBucket();
    if (cur.children[path]) return;
    // Mark loading
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: {
          ...cur,
          children: { ...cur.children, [path]: "loading" },
        },
      },
    }));
    try {
      const entries = await fsApi.readDir(path);
      set((state) => {
        const b = state.byProject[projectId] ?? emptyBucket();
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
              ...b,
              children: { ...b.children, [path]: entries },
            },
          },
        };
      });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      set((state) => {
        const b = state.byProject[projectId] ?? emptyBucket();
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
              ...b,
              children: { ...b.children, [path]: { error: message } },
            },
          },
        };
      });
    }
  },

  refresh: async (projectId, path) => {
    const cur = get().byProject[projectId] ?? emptyBucket();
    // Snapshot the previous listing so we can diff after the reload.
    // We only mark "recent" when there was a prior listing , first-time
    // loads of a folder shouldn't tint every single entry.
    const before = cur.children[path];
    const beforePaths =
      Array.isArray(before) ? new Set(before.map((e) => e.path)) : null;

    // Read fresh WITHOUT clearing the current listing first. The old code did
    // delete -> "loading" -> load, which made an expanded folder flash to a
    // spinner (its contents momentarily vanished) on every single watcher tick
    // while an agent wrote files into it. We instead keep the last good listing
    // on screen and swap it atomically once the new read resolves.
    let entries: DirEntry[];
    try {
      entries = await fsApi.readDir(path);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      set((state) => {
        const b = state.byProject[projectId] ?? emptyBucket();
        // Keep the last good listing rather than blanking it on a transient
        // read failure; only surface an error if we had nothing before.
        if (Array.isArray(b.children[path])) return state;
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
              ...b,
              children: { ...b.children, [path]: { error: message } },
            },
          },
        };
      });
      return;
    }

    // Swap atomically against the *current* state (not the stale `cur`
    // snapshot) so concurrent refreshes of sibling dirs don't clobber it.
    set((state) => {
      const b = state.byProject[projectId] ?? emptyBucket();
      return {
        byProject: {
          ...state.byProject,
          [projectId]: { ...b, children: { ...b.children, [path]: entries } },
        },
      };
    });

    if (!beforePaths) return;
    const created = entries
      .map((e) => e.path)
      .filter((p) => !beforePaths.has(p));
    if (created.length === 0) return;

    const now = Date.now();
    set((state) => {
      const b = state.byProject[projectId] ?? emptyBucket();
      const recent = { ...b.recentlyAdded };
      for (const p of created) recent[p] = now;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: { ...b, recentlyAdded: recent },
        },
      };
    });
    // Auto-clear after the TTL. If the entry was already removed (deleted,
    // moved, project closed), clearRecent is a no-op.
    for (const p of created) {
      setTimeout(() => get().clearRecent(projectId, p), RECENT_TTL_MS);
    }
  },

  clearProject: (projectId) =>
    set((state) => {
      const { [projectId]: _, ...rest } = state.byProject;
      return { byProject: rest };
    }),

  clearRecent: (projectId, path) =>
    set((state) => {
      const cur = state.byProject[projectId];
      if (!cur || !(path in cur.recentlyAdded)) return state;
      const { [path]: _, ...rest } = cur.recentlyAdded;
      return {
        byProject: {
          ...state.byProject,
          [projectId]: { ...cur, recentlyAdded: rest },
        },
      };
    }),

  setSelected: (projectId, selected) =>
    set((state) => {
      const cur = state.byProject[projectId] ?? emptyBucket();
      return {
        byProject: { ...state.byProject, [projectId]: { ...cur, selected } },
      };
    }),

  beginCreate: async (projectId, parentPath, kind) => {
    // Ensure the parent is expanded and its children are loaded so the inline
    // input shows up in the right place.
    const cur = get().byProject[projectId] ?? emptyBucket();
    const nextExpanded = new Set(cur.expanded);
    nextExpanded.add(parentPath);
    set((state) => {
      const b = state.byProject[projectId] ?? emptyBucket();
      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...b,
            expanded: nextExpanded,
            creating: { parentPath, kind },
          },
        },
      };
    });
    await get().loadIfNeeded(projectId, parentPath);
  },

  cancelCreate: (projectId) =>
    set((state) => {
      const cur = state.byProject[projectId];
      if (!cur) return state;
      return {
        byProject: { ...state.byProject, [projectId]: { ...cur, creating: null } },
      };
    }),

  createNode: async (projectId, parentPath, name, kind) => {
    const newPath =
      kind === "dir"
        ? await fsApi.createDir(parentPath, name)
        : await fsApi.createFile(parentPath, name);
    set((state) => {
      const cur = state.byProject[projectId] ?? emptyBucket();
      return {
        byProject: {
          ...state.byProject,
          [projectId]: { ...cur, creating: null },
        },
      };
    });
    await get().refresh(projectId, parentPath);
    return newPath;
  },

}));
