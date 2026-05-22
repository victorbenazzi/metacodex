import { create } from "zustand";
import type { TerminalSession, TerminalStatus } from "./terminal.types";

interface TerminalState {
  sessions: Record<string, TerminalSession>;
  /** Per-project (or WORKSPACE_NULL) id of the terminal the user last focused —
   * the target for "send selection to terminal" from the editor. */
  lastFocusedByProject: Record<string, string>;
  register: (s: TerminalSession) => void;
  update: (id: string, patch: Partial<TerminalSession>) => void;
  setStatus: (id: string, status: TerminalStatus, exitCode?: number) => void;
  remove: (id: string) => void;
  getById: (id: string) => TerminalSession | undefined;
  setLastFocused: (projectKey: string, sessionId: string) => void;
  getLastFocused: (projectKey: string) => string | undefined;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: {},
  lastFocusedByProject: {},
  register: (s) =>
    set((state) => ({
      sessions: { ...state.sessions, [s.id]: s },
    })),
  update: (id, patch) =>
    set((state) => {
      const cur = state.sessions[id];
      if (!cur) return state;
      return { sessions: { ...state.sessions, [id]: { ...cur, ...patch } } };
    }),
  setStatus: (id, status, exitCode) =>
    set((state) => {
      const cur = state.sessions[id];
      if (!cur) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: { ...cur, status, ...(exitCode != null ? { exitCode } : {}) },
        },
      };
    }),
  remove: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.sessions;
      // Drop any "last focused" pointer to the removed session.
      const lastFocusedByProject = Object.fromEntries(
        Object.entries(state.lastFocusedByProject).filter(([, sid]) => sid !== id),
      );
      return { sessions: rest, lastFocusedByProject };
    }),
  getById: (id) => get().sessions[id],
  setLastFocused: (projectKey, sessionId) =>
    set((state) => {
      if (state.lastFocusedByProject[projectKey] === sessionId) return state;
      return {
        lastFocusedByProject: { ...state.lastFocusedByProject, [projectKey]: sessionId },
      };
    }),
  getLastFocused: (projectKey) => get().lastFocusedByProject[projectKey],
}));
