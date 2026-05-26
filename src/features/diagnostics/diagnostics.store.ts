import { create } from "zustand";

/**
 * Event kinds the diagnostics panel surfaces. Add a new variant here whenever a
 * code path needs to be observable post-hoc (Cmd+Shift+D opens the panel and
 * shows everything emitted since app launch, capped at MAX_ENTRIES).
 */
export type DiagKind =
  | "pty.spawn"
  | "pty.exit"
  | "pty.backpressure"
  | "pty.reader_error"
  | "pty.kill"
  | "fs.changed"
  | "fs.error"
  | "fs.renamed"
  | "workspace.save.ok"
  | "workspace.save.fail"
  | "workspace.load.fail"
  | "ipc.command.fail"
  | "tab.remap"
  | "tab.close_external"
  | "app.before_quit"
  | "error_boundary.caught";

export interface DiagEntry {
  id: number;
  ts: number;
  kind: DiagKind;
  sessionId?: string;
  projectId?: string;
  tabId?: string;
  /** Free-form structured detail; rendered as JSON in the panel. */
  detail?: Record<string, unknown>;
}

const MAX_ENTRIES = 500;

interface DiagFilters {
  /** Substring matched against kind. Empty = show all kinds. */
  kindFilter: string;
  /** Specific session id to highlight (set by clicking a session-scoped entry). */
  sessionIdFilter: string | null;
}

interface DiagState {
  open: boolean;
  entries: DiagEntry[];
  filters: DiagFilters;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setKindFilter: (value: string) => void;
  setSessionIdFilter: (value: string | null) => void;
  record: (
    kind: DiagKind,
    extras?: { sessionId?: string; projectId?: string; tabId?: string; detail?: Record<string, unknown> },
  ) => void;
  clear: () => void;
  /** Serialize all entries as JSONL for clipboard / disk dump. */
  serialize: () => string;
}

let nextId = 1;

export const useDiagnosticsStore = create<DiagState>((set, get) => ({
  open: false,
  entries: [],
  filters: { kindFilter: "", sessionIdFilter: null },
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setKindFilter: (value) =>
    set((s) => ({ filters: { ...s.filters, kindFilter: value } })),
  setSessionIdFilter: (value) =>
    set((s) => ({ filters: { ...s.filters, sessionIdFilter: value } })),
  record: (kind, extras) =>
    set((s) => {
      const next: DiagEntry = {
        id: nextId++,
        ts: Date.now(),
        kind,
        ...extras,
      };
      const list = s.entries.length >= MAX_ENTRIES
        ? [...s.entries.slice(s.entries.length - MAX_ENTRIES + 1), next]
        : [...s.entries, next];
      return { entries: list };
    }),
  clear: () => set({ entries: [] }),
  serialize: () =>
    get().entries.map((e) => JSON.stringify(e)).join("\n"),
}));

/**
 * Convenience helper for one-line recording from anywhere in the app. Keeps the
 * call sites readable: `recordDiag("workspace.save.ok", { projectId })`.
 */
export function recordDiag(
  kind: DiagKind,
  extras?: { sessionId?: string; projectId?: string; tabId?: string; detail?: Record<string, unknown> },
): void {
  useDiagnosticsStore.getState().record(kind, extras);
}
