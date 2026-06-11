import { create } from "zustand";

import { CMD, invoke } from "@/lib/ipc";

import { qs } from "./oc";

/**
 * Per-project conversation history for the Agent View sidebar, driven entirely
 * by the opencode sidecar (the harness owns the sessions; we only mirror them):
 *
 * - `GET /session?directory=` lists a project's sessions (swarm children are
 *   filtered out via `parentID`).
 * - Pin rides opencode's free-form session `metadata` (`{ pinned: true }`).
 * - Archive rides opencode's native `time.archived` (PATCH; `0` un-archives).
 * - Live status comes from `session.status` / `session.idle` SSE events
 *   (forwarded by the chat store, which owns the single EventSource) plus a
 *   `GET /session/status` poll that catches headless runs in other projects.
 *
 * Composer drafts (the "pencil" rows) and the sidebar's expand/collapse choices
 * are the pieces opencode can't hold (no session exists before the first send):
 * they persist together to `~/.metacodex/state/agent-ui.json`. Expansion only
 * stores EXPLICIT user choices; without one, a project derives its state from
 * content (collapsed while empty, auto-opens when the first conversation or
 * draft lands), and a manual toggle wins from then on.
 *
 * The base URL is pushed in by the chat store on connect, this store never
 * imports the chat store, so the dependency stays one-way.
 */

export interface SessionRow {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
}

/** Store key for a directory; `null` (no folder) buckets under "". */
export function dirKey(directory: string | null): string {
  return directory ?? "";
}

interface OcSession {
  id?: string;
  parentID?: string;
  directory?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  time?: { created?: number; updated?: number; archived?: number };
}

interface AgentSessionsState {
  baseUrl: string | null;
  byDirectory: Record<string, SessionRow[]>;
  /** User-archived sessions per directory (machine one-shots filtered out);
   *  rendered in the sidebar's collapsed "Archived" group, restorable. */
  archivedByDirectory: Record<string, SessionRow[]>;
  loaded: Record<string, boolean>;
  /** Session ids the harness reports as busy (status != idle). */
  runningById: Record<string, true>;
  drafts: Record<string, string>;
  /** Explicit user expand/collapse choices only; absent key = derive from content. */
  expandedByDir: Record<string, boolean>;
  uiStateHydrated: boolean;

  setBaseUrl: (url: string | null) => void;
  loadSessions: (directory: string | null) => Promise<void>;
  refreshStatus: () => Promise<void>;
  setPinned: (directory: string | null, id: string, pinned: boolean) => Promise<void>;
  archive: (directory: string | null, id: string) => Promise<void>;
  /** Bring an archived session back to the live list (`time.archived: 0`). */
  unarchive: (directory: string | null, id: string) => Promise<void>;
  rename: (directory: string | null, id: string, title: string) => Promise<void>;
  /** DELETE the session from opencode permanently (vs archive, which hides). */
  remove: (directory: string | null, id: string) => Promise<void>;
  /** Fork a session (whole, or up to `messageID`); resolves the new session
   *  id, or null on failure. The original is untouched. */
  fork: (directory: string | null, id: string, messageID?: string) => Promise<string | null>;
  markRunning: (id: string) => void;
  /** Fold a raw opencode SSE event into the history/status mirrors. */
  applySessionEvent: (ev: { type: string; properties?: Record<string, unknown> }) => void;

  hydrateUiState: () => Promise<void>;
  setDraft: (directory: string | null, text: string) => void;
  clearDraft: (directory: string | null) => void;
  setExpanded: (directory: string | null, expanded: boolean) => void;
}

/** Map an opencode session row to the sidebar shape; null = filtered out.
 *  Archived sessions still map (they land in `archivedByDirectory`); only
 *  swarm children and machine-made throwaway one-shots are dropped. */
function mapSession(raw: OcSession): SessionRow | null {
  if (!raw.id || raw.parentID) return null; // swarm children stay nested in chat
  if (raw.metadata?.throwaway === true) return null; // relay/one-shot sessions
  return {
    id: raw.id,
    title: raw.title ?? "",
    createdAt: raw.time?.created ?? 0,
    updatedAt: raw.time?.updated ?? raw.time?.created ?? 0,
    pinned: raw.metadata?.pinned === true,
  };
}

/** Pinned first, then most recently updated. */
function sortRows(rows: SessionRow[]): SessionRow[] {
  return rows
    .slice()
    .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || b.updatedAt - a.updatedAt);
}

// Debounced disk persistence for the UI state file, one timer for everything.
let uiSaveTimer: ReturnType<typeof setTimeout> | null = null;
function persistUiState(drafts: Record<string, string>, expanded: Record<string, boolean>) {
  if (uiSaveTimer) clearTimeout(uiSaveTimer);
  uiSaveTimer = setTimeout(() => {
    void invoke(CMD.agentUiStateWrite, { state: { drafts, expanded } }).catch(() => undefined);
  }, 400);
}

// Optimistic running marks (`markRunning` on send), with a grace window so a
// status poll snapshot taken BEFORE the server marked the session busy can't
// wipe the dot right after a send.
const recentMarks = new Map<string, number>();
const MARK_GRACE_MS = 15_000;

/** Identical-list check so a poll that changed nothing skips the store set
 *  (every set re-renders every visible thread row). */
function rowsEqual(a: SessionRow[], b: SessionRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.title !== y.title ||
      x.updatedAt !== y.updatedAt ||
      x.pinned !== y.pinned
    ) {
      return false;
    }
  }
  return true;
}

export const useAgentSessionsStore = create<AgentSessionsState>((set, get) => ({
  baseUrl: null,
  byDirectory: {},
  archivedByDirectory: {},
  loaded: {},
  runningById: {},
  drafts: {},
  expandedByDir: {},
  uiStateHydrated: false,

  setBaseUrl: (url) => set({ baseUrl: url }),

  loadSessions: async (directory) => {
    const base = get().baseUrl;
    if (!base) return;
    const key = dirKey(directory);
    try {
      const res = await fetch(`${base}/session${qs(directory)}`);
      if (!res.ok) return;
      const rows: unknown = await res.json();
      const live: SessionRow[] = [];
      const archived: SessionRow[] = [];
      for (const raw of Array.isArray(rows) ? (rows as OcSession[]) : []) {
        const row = mapSession(raw);
        if (!row) continue;
        if (raw.time?.archived) archived.push(row);
        else live.push(row);
      }
      const liveSorted = sortRows(live);
      const archivedSorted = sortRows(archived);
      set((s) => {
        if (
          s.loaded[key] &&
          rowsEqual(s.byDirectory[key] ?? [], liveSorted) &&
          rowsEqual(s.archivedByDirectory[key] ?? [], archivedSorted)
        ) {
          return {};
        }
        return {
          byDirectory: { ...s.byDirectory, [key]: liveSorted },
          archivedByDirectory: { ...s.archivedByDirectory, [key]: archivedSorted },
          loaded: { ...s.loaded, [key]: true },
        };
      });
    } catch {
      // sidecar offline / mid-restart; the next load or event repopulates
    }
  },

  refreshStatus: async () => {
    const base = get().baseUrl;
    if (!base) return;
    try {
      const res = await fetch(`${base}/session/status`);
      if (!res.ok) return;
      const map = (await res.json()) as Record<string, { type?: string } | undefined>;
      const runningById: Record<string, true> = {};
      for (const [id, status] of Object.entries(map ?? {})) {
        if (status && status.type !== "idle") runningById[id] = true;
      }
      // Keep fresh optimistic marks the snapshot may predate.
      const cutoff = Date.now() - MARK_GRACE_MS;
      for (const [id, at] of recentMarks) {
        if (at >= cutoff) runningById[id] = true;
        else recentMarks.delete(id);
      }
      set({ runningById });
    } catch {
      // best-effort; SSE events keep the active project live regardless
    }
  },

  setPinned: async (directory, id, pinned) => {
    const base = get().baseUrl;
    if (!base) return;
    const key = dirKey(directory);
    // Optimistic: re-rank locally, reconcile on the next load if the PATCH fails.
    set((s) => ({
      byDirectory: {
        ...s.byDirectory,
        [key]: sortRows(
          (s.byDirectory[key] ?? []).map((r) => (r.id === id ? { ...r, pinned } : r)),
        ),
      },
    }));
    try {
      const res = await fetch(`${base}/session/${id}${qs(directory)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { pinned } }),
      });
      if (!res.ok) void get().loadSessions(directory);
    } catch {
      void get().loadSessions(directory);
    }
  },

  archive: async (directory, id) => {
    const base = get().baseUrl;
    if (!base) return;
    const key = dirKey(directory);
    // Optimistic move into the archived group (not a removal: the row stays
    // reachable under "Archived" and restorable from there).
    set((s) => {
      const cur = s.byDirectory[key] ?? [];
      const row = cur.find((r) => r.id === id);
      return {
        byDirectory: { ...s.byDirectory, [key]: cur.filter((r) => r.id !== id) },
        ...(row
          ? {
              archivedByDirectory: {
                ...s.archivedByDirectory,
                [key]: sortRows([
                  ...(s.archivedByDirectory[key] ?? []).filter((r) => r.id !== id),
                  row,
                ]),
              },
            }
          : {}),
      };
    });
    try {
      const res = await fetch(`${base}/session/${id}${qs(directory)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: { archived: Date.now() } }),
      });
      if (!res.ok) void get().loadSessions(directory);
    } catch {
      void get().loadSessions(directory);
    }
  },

  unarchive: async (directory, id) => {
    const base = get().baseUrl;
    if (!base) return;
    const key = dirKey(directory);
    set((s) => {
      const cur = s.archivedByDirectory[key] ?? [];
      const row = cur.find((r) => r.id === id);
      return {
        archivedByDirectory: {
          ...s.archivedByDirectory,
          [key]: cur.filter((r) => r.id !== id),
        },
        ...(row
          ? {
              byDirectory: {
                ...s.byDirectory,
                [key]: sortRows([
                  ...(s.byDirectory[key] ?? []).filter((r) => r.id !== id),
                  row,
                ]),
              },
            }
          : {}),
      };
    });
    try {
      const res = await fetch(`${base}/session/${id}${qs(directory)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // A zeroed timestamp un-archives on the opencode side.
        body: JSON.stringify({ time: { archived: 0 } }),
      });
      if (!res.ok) void get().loadSessions(directory);
    } catch {
      void get().loadSessions(directory);
    }
  },

  rename: async (directory, id, title) => {
    const base = get().baseUrl;
    const trimmed = title.trim();
    if (!base || !trimmed) return;
    const key = dirKey(directory);
    set((s) => ({
      byDirectory: {
        ...s.byDirectory,
        [key]: (s.byDirectory[key] ?? []).map((r) =>
          r.id === id ? { ...r, title: trimmed } : r,
        ),
      },
    }));
    try {
      const res = await fetch(`${base}/session/${id}${qs(directory)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) void get().loadSessions(directory);
    } catch {
      void get().loadSessions(directory);
    }
  },

  remove: async (directory, id) => {
    const base = get().baseUrl;
    if (!base) return;
    const key = dirKey(directory);
    set((s) => ({
      byDirectory: {
        ...s.byDirectory,
        [key]: (s.byDirectory[key] ?? []).filter((r) => r.id !== id),
      },
      archivedByDirectory: {
        ...s.archivedByDirectory,
        [key]: (s.archivedByDirectory[key] ?? []).filter((r) => r.id !== id),
      },
    }));
    try {
      const res = await fetch(`${base}/session/${id}${qs(directory)}`, { method: "DELETE" });
      if (!res.ok) void get().loadSessions(directory);
    } catch {
      void get().loadSessions(directory);
    }
  },

  fork: async (directory, id, messageID) => {
    const base = get().baseUrl;
    if (!base) return null;
    const key = dirKey(directory);
    try {
      const res = await fetch(`${base}/session/${id}/fork${qs(directory)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messageID ? { messageID } : {}),
      });
      if (!res.ok) return null;
      const created = (await res.json()) as OcSession;
      // Optimistic insert (the fork arrives with `parentID: null` and the
      // inherited title); loadSessions reconciles right after.
      const row = mapSession(created);
      if (row) {
        set((s) => {
          const cur = (s.byDirectory[key] ?? []).filter((r) => r.id !== row.id);
          return { byDirectory: { ...s.byDirectory, [key]: sortRows([...cur, row]) } };
        });
      }
      void get().loadSessions(directory);
      return created.id ?? null;
    } catch {
      return null;
    }
  },

  markRunning: (id) => {
    recentMarks.set(id, Date.now());
    set((s) => ({ runningById: { ...s.runningById, [id]: true } }));
  },

  applySessionEvent: (ev) => {
    const props = ev.properties ?? {};
    switch (ev.type) {
      case "session.created":
      case "session.updated": {
        const info = props.info as OcSession | undefined;
        if (!info?.id || info.parentID) return;
        const key = dirKey(info.directory ?? null);
        // Only fold into buckets we've already loaded; others load fresh on demand.
        if (!get().loaded[key]) return;
        const row = mapSession(info);
        const archived = !!info.time?.archived;
        // Route by archived state: an archive/unarchive done elsewhere (or by
        // another client) moves the row between the two groups.
        set((s) => {
          const live = (s.byDirectory[key] ?? []).filter((r) => r.id !== info.id);
          const arch = (s.archivedByDirectory[key] ?? []).filter((r) => r.id !== info.id);
          return {
            byDirectory: {
              ...s.byDirectory,
              [key]: sortRows(row && !archived ? [...live, row] : live),
            },
            archivedByDirectory: {
              ...s.archivedByDirectory,
              [key]: sortRows(row && archived ? [...arch, row] : arch),
            },
          };
        });
        return;
      }
      case "session.deleted": {
        const info = props.info as OcSession | undefined;
        if (!info?.id) return;
        set((s) => {
          const byDirectory: Record<string, SessionRow[]> = {};
          for (const [key, rows] of Object.entries(s.byDirectory)) {
            byDirectory[key] = rows.filter((r) => r.id !== info.id);
          }
          const archivedByDirectory: Record<string, SessionRow[]> = {};
          for (const [key, rows] of Object.entries(s.archivedByDirectory)) {
            archivedByDirectory[key] = rows.filter((r) => r.id !== info.id);
          }
          return { byDirectory, archivedByDirectory };
        });
        return;
      }
      case "session.status": {
        const sid = props.sessionID as string | undefined;
        const status = props.status as { type?: string } | undefined;
        if (!sid) return;
        set((s) => {
          const runningById = { ...s.runningById };
          if (status && status.type !== "idle") runningById[sid] = true;
          else delete runningById[sid];
          return { runningById };
        });
        return;
      }
      case "session.idle":
      case "session.error": {
        const sid = props.sessionID as string | undefined;
        if (!sid) return;
        recentMarks.delete(sid);
        set((s) => {
          const runningById = { ...s.runningById };
          delete runningById[sid];
          return { runningById };
        });
        return;
      }
      default:
        return;
    }
  },

  hydrateUiState: async () => {
    if (get().uiStateHydrated) return;
    set({ uiStateHydrated: true });
    try {
      const raw = await invoke<{ drafts?: unknown; expanded?: unknown }>(CMD.agentUiStateRead);
      const drafts: Record<string, string> = {};
      for (const [key, value] of Object.entries((raw?.drafts as object) ?? {})) {
        if (typeof value === "string" && value.trim()) drafts[key] = value;
      }
      const expandedByDir: Record<string, boolean> = {};
      for (const [key, value] of Object.entries((raw?.expanded as object) ?? {})) {
        if (typeof value === "boolean") expandedByDir[key] = value;
      }
      // Merge UNDER current state: a keystroke or chevron toggle made while the
      // disk read was in flight wins over the stale snapshot.
      set((s) => ({
        drafts: { ...drafts, ...s.drafts },
        expandedByDir: { ...expandedByDir, ...s.expandedByDir },
      }));
    } catch {
      // missing/corrupt file: start empty, next save rewrites it
    }
  },

  setDraft: (directory, text) => {
    const key = dirKey(directory);
    set((s) => {
      const drafts = { ...s.drafts };
      if (text.trim()) drafts[key] = text;
      else delete drafts[key];
      persistUiState(drafts, s.expandedByDir);
      return { drafts };
    });
  },

  clearDraft: (directory) => {
    const key = dirKey(directory);
    set((s) => {
      if (!(key in s.drafts)) return {};
      const drafts = { ...s.drafts };
      delete drafts[key];
      persistUiState(drafts, s.expandedByDir);
      return { drafts };
    });
  },

  setExpanded: (directory, expanded) => {
    const key = dirKey(directory);
    set((s) => {
      const expandedByDir = { ...s.expandedByDir, [key]: expanded };
      persistUiState(s.drafts, expandedByDir);
      return { expandedByDir };
    });
  },
}));
