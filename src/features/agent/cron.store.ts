import { create } from "zustand";

import { CMD, invoke } from "@/lib/ipc";

import { errMessage } from "./oc";

/**
 * A scheduled task mirrored from Rust (`agent/scheduler.rs::CronTask`). The
 * schedule is a standard 5-field cron expression, the same string a future
 * external scheduler (trigger.dev / Railway) would consume. The local loop fires
 * it while the app is open. Scheduler-internal bookkeeping (`lastFiredMinute`,
 * `runCount`) deliberately stays OUT of this client type.
 */
/** One execution of a task. `sessionId` is the opencode session it ran in, so
 *  the UI can open that run as a chat thread. */
export interface CronRun {
  ranAt: number;
  sessionId: string | null;
  status: string;
}

export interface CronTask {
  id: string;
  title: string;
  prompt: string;
  cron: string;
  directory: string | null;
  providerId: string;
  modelId: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastSessionId: string | null;
  lastStatus: string | null;
  runs: CronRun[];
}

/** Mutation outcome: the error travels WITH the result instead of forcing the
 *  caller to re-read the store after the fact. */
export interface CronMutationResult {
  ok: boolean;
  error: string | null;
}

export interface NewCronInput {
  title: string;
  prompt: string;
  cron: string;
  directory: string | null;
  providerId: string;
  modelId: string;
}

interface CronState {
  tasks: CronTask[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: NewCronInput) => Promise<CronMutationResult>;
  update: (id: string, input: NewCronInput) => Promise<CronMutationResult>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  runNow: (id: string) => Promise<void>;
}

export const useAgentCronStore = create<CronState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const tasks = await invoke<CronTask[]>(CMD.agentCronList);
      // Skip identical payloads: the 20s sidebar poll would otherwise
      // re-render every task row even when nothing changed.
      set((s) =>
        JSON.stringify(s.tasks) === JSON.stringify(tasks) ? {} : { tasks },
      );
    } catch (e) {
      set({ error: errMessage(e) });
    } finally {
      set({ loading: false });
    }
  },

  create: async (input) => {
    try {
      await invoke<CronTask>(CMD.agentCronCreate, { input });
      await get().load();
      return { ok: true, error: null };
    } catch (e) {
      const error = errMessage(e);
      set({ error });
      return { ok: false, error };
    }
  },

  update: async (id, input) => {
    try {
      await invoke<CronTask>(CMD.agentCronUpdate, { id, input });
      await get().load();
      return { ok: true, error: null };
    } catch (e) {
      const error = errMessage(e);
      set({ error });
      return { ok: false, error };
    }
  },

  remove: async (id) => {
    try {
      await invoke(CMD.agentCronDelete, { id });
      await get().load();
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  setEnabled: async (id, enabled) => {
    try {
      await invoke(CMD.agentCronSetEnabled, { id, enabled });
      await get().load();
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  runNow: async (id) => {
    try {
      await invoke(CMD.agentCronRunNow, { id });
      await get().load();
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },
}));
