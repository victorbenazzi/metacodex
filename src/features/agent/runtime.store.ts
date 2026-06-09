import { create } from "zustand";

import { CMD, invoke } from "@/lib/ipc";

export interface AgentModel {
  id: string;
  name: string;
}

export interface AgentProvider {
  id: string;
  name: string;
  defaultModel: string | null;
  models: AgentModel[];
}

export interface RuntimeStatus {
  running: boolean;
  baseUrl: string | null;
  version: string | null;
}

const IDLE_STATUS: RuntimeStatus = { running: false, baseUrl: null, version: null };

interface RuntimeState {
  status: RuntimeStatus;
  providers: AgentProvider[];
  starting: boolean;
  loadingModels: boolean;
  error: string | null;

  /** Start (or reuse) the opencode sidecar and refresh status. */
  start: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  loadModels: () => Promise<void>;
  setCredentials: (providerId: string, key: string) => Promise<void>;
  stop: () => Promise<void>;
}

function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

export const useAgentRuntimeStore = create<RuntimeState>((set) => ({
  status: IDLE_STATUS,
  providers: [],
  starting: false,
  loadingModels: false,
  error: null,

  start: async () => {
    set({ starting: true, error: null });
    try {
      const status = await invoke<RuntimeStatus>(CMD.agentRuntimeStart);
      set({ status });
    } catch (e) {
      set({ error: errMessage(e) });
    } finally {
      set({ starting: false });
    }
  },

  refreshStatus: async () => {
    try {
      set({ status: await invoke<RuntimeStatus>(CMD.agentRuntimeStatus) });
    } catch {
      // status is best-effort; leave the last known value
    }
  },

  loadModels: async () => {
    set({ loadingModels: true, error: null });
    try {
      const providers = await invoke<AgentProvider[]>(CMD.agentListModels);
      set({ providers });
    } catch (e) {
      set({ error: errMessage(e) });
    } finally {
      set({ loadingModels: false });
    }
  },

  setCredentials: async (providerId, key) => {
    await invoke(CMD.agentSetCredentials, { providerId, key });
  },

  stop: async () => {
    try {
      await invoke(CMD.agentRuntimeStop);
    } catch {
      // ignore — stopping is best-effort
    }
    set({ status: IDLE_STATUS });
  },
}));
