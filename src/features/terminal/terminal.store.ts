import { create } from "zustand";
import type { TerminalSession, TerminalStatus } from "./terminal.types";

interface TerminalState {
  sessions: Record<string, TerminalSession>;
  register: (s: TerminalSession) => void;
  update: (id: string, patch: Partial<TerminalSession>) => void;
  setStatus: (id: string, status: TerminalStatus, exitCode?: number) => void;
  remove: (id: string) => void;
  getById: (id: string) => TerminalSession | undefined;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: {},
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
      return { sessions: rest };
    }),
  getById: (id) => get().sessions[id],
}));
