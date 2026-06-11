import { create } from "zustand";

import { CMD, invoke } from "@/lib/ipc";

export interface AgentModel {
  id: string;
  name: string;
  /** Accepts file/image attachments (vision). */
  attachment: boolean;
  reasoning: boolean;
  /** Reasoning-effort variant names (sent as `variant` on the message POST).
   *  Arrives unordered from the catalog; render via `orderedVariants`. */
  variants: string[];
  /** Token windows from the catalog; `context` feeds the context meter. */
  limit?: { context?: number; output?: number } | null;
}

const VARIANT_RANK: Record<string, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  max: 4,
  xhigh: 5,
};

/** Canonical effort order (minimal → max); unknown names go last, as-is. */
export function orderedVariants(variants: string[]): string[] {
  return [...variants].sort(
    (a, b) => (VARIANT_RANK[a] ?? 99) - (VARIANT_RANK[b] ?? 99) || a.localeCompare(b),
  );
}

export interface AgentProvider {
  id: string;
  name: string;
  defaultModel: string | null;
  models: AgentModel[];
}

/** Look up a model in the catalog; null when the catalog hasn't loaded it. */
export function findModel(
  providers: AgentProvider[],
  providerId: string,
  modelId: string,
): AgentModel | null {
  return providers.find((p) => p.id === providerId)?.models.find((m) => m.id === modelId) ?? null;
}

/** First attachment-capable model, the vision-relay auto default. Prefers the
 *  given provider so the relay stays on the user's account when possible. */
export function firstVisionModel(
  providers: AgentProvider[],
  preferProviderId?: string,
): { providerId: string; modelId: string } | null {
  const ordered = preferProviderId
    ? [...providers.filter((p) => p.id === preferProviderId), ...providers.filter((p) => p.id !== preferProviderId)]
    : providers;
  for (const p of ordered) {
    const m = p.models.find((m) => m.attachment);
    if (m) return { providerId: p.id, modelId: m.id };
  }
  return null;
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
      // ignore, stopping is best-effort
    }
    set({ status: IDLE_STATUS });
  },
}));
