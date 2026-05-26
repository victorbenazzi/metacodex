import { create } from "zustand";

export interface ListeningPort {
  port: number;
  protocol: string;
  address: string;
}

export interface PtyMetadata {
  sessionId: string;
  pid: number;
  cwd: string;
  branch: string | null;
  listeningPorts: ListeningPort[];
}

export interface TabMetadataEntry extends PtyMetadata {
  fetchedAt: number;
}

interface TabMetadataState {
  /** Keyed by PTY session id (not tab id) — keeps the store decoupled from
   *  tab-bucket churn and lets callers look up via the terminal store's
   *  tab→session mapping. */
  bySessionId: Record<string, TabMetadataEntry>;
  setMeta: (sessionId: string, meta: PtyMetadata) => void;
  setBatch: (entries: PtyMetadata[]) => void;
  clear: (sessionId: string) => void;
}

export const useTabMetadataStore = create<TabMetadataState>((set) => ({
  bySessionId: {},
  setMeta: (sessionId, meta) =>
    set((state) => ({
      bySessionId: {
        ...state.bySessionId,
        [sessionId]: { ...meta, fetchedAt: Date.now() },
      },
    })),
  setBatch: (entries) =>
    set((state) => {
      const next = { ...state.bySessionId };
      const now = Date.now();
      for (const e of entries) {
        next[e.sessionId] = { ...e, fetchedAt: now };
      }
      return { bySessionId: next };
    }),
  clear: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.bySessionId)) return state;
      const { [sessionId]: _, ...rest } = state.bySessionId;
      return { bySessionId: rest };
    }),
}));
