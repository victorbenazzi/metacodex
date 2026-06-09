import { create } from "zustand";

import { CMD, invoke } from "@/lib/ipc";

export interface CronTask {
  id: string;
  title: string;
  prompt: string;
  intervalMinutes: number;
  providerId: string;
  modelId: string;
  enabled: boolean;
  lastRunAt: number | null;
  lastSessionId: string | null;
}

export interface NewCronInput {
  title: string;
  prompt: string;
  intervalMinutes: number;
  providerId: string;
  modelId: string;
}

interface CronState {
  tasks: CronTask[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: NewCronInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  runNow: (id: string) => Promise<void>;
}

function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

export const useAgentCronStore = create<CronState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const tasks = await invoke<CronTask[]>(CMD.agentCronList);
      set({ tasks });
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
    } catch (e) {
      set({ error: errMessage(e) });
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
