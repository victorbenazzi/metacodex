import { create } from "zustand";

import { CMD, invoke } from "@/lib/ipc";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";

import {
  registerSessionEntityHandler,
  useAgentChatStore,
  type SelectedEntity,
} from "./chat.store";
import { errMessage } from "./oc";

/**
 * Agent entities ("Agentes"): persistent agents whose home lives in
 * `~/.metacodex/agents/<slug>/` (Rust `AgentEntityStore` owns the truth; see
 * AGENTS_DESIGN.md). Every mutation regenerates the OPENCODE_CONFIG layer in
 * Rust; this store then HOT-APPLIES the change without a sidecar restart:
 * opencode caches config per directory instance, so `POST /global/dispose`
 * makes the next call rebuild instances from the fresh file. After the
 * dispose we reload the chat store's agent catalog (`GET /agent`).
 */

export interface AgentAvatar {
  kind: "emoji" | "image";
  /** Emoji text, or a data URL for images (resolved by Rust). */
  value: string;
}

export interface AgentEntity {
  id: string;
  name: string;
  persona: string;
  avatar?: AgentAvatar;
  color?: string;
  providerId?: string;
  modelId?: string;
  variant?: string;
  permissionPreset: "ask" | "auto-edit" | "full-auto";
  /** Registered project ids this agent may work in; absent = all. */
  projects?: string[];
  heartbeat: { enabled: boolean; intervalMinutes: number };
  dreamAfterRuns: number;
  continuationCap: number;
  /** Compiled opencode agent name (`mcx-<slug>`), what the chat sends. */
  opencodeName: string;
  createdAt?: string;
  updatedAt?: string;
}

export type AgentAvatarInput =
  | { kind: "emoji"; value: string }
  | { kind: "image"; dataUrl: string }
  | { kind: "keep" };

export interface AgentEntityInput {
  id?: string;
  name: string;
  persona: string;
  avatar?: AgentAvatarInput;
  color?: string;
  providerId?: string;
  modelId?: string;
  variant?: string;
  permissionPreset: "ask" | "auto-edit" | "full-auto";
  projects?: string[];
  /** Harness knobs (Agenda tab); absent = keep stored values. */
  heartbeat?: { enabled: boolean; intervalMinutes: number };
  dreamAfterRuns?: number;
  continuationCap?: number;
}

/** ---- Life harness payloads (phases 2-4), mirrored from agent/life.rs ---- */

export interface MemoryFileInfo {
  relPath: string;
  name: string;
}

export interface MemoryTree {
  index: string;
  files: MemoryFileInfo[];
  projects: { key: string; index: string; files: MemoryFileInfo[] }[];
}

export interface ReportInfo {
  file: string;
  title: string;
  trigger: string;
  status: "ok" | "needs-you" | "aborted" | "error" | string;
  project?: string;
  createdAt: number;
  content: string;
}

export interface RunLogEntry {
  trigger: string;
  startedAt: number;
  finishedAt: number;
  status: string;
  sessionId?: string;
  directory?: string;
  continuations: number;
}

export interface AgentActivity {
  reports: ReportInfo[];
  runs: RunLogEntry[];
}

export interface ProposalInfo {
  file: string;
  title: string;
  kind: "persona" | "skill" | "new-agent" | string;
  status: "pending" | "approved" | "rejected" | string;
  content: string;
  persona?: string;
}

export const entityLifeApi = {
  memoryTree: (id: string) => invoke<MemoryTree>(CMD.agentEntityMemoryTree, { id }),
  memoryRead: (id: string, relPath: string) =>
    invoke<string>(CMD.agentEntityMemoryRead, { id, relPath }),
  memoryWrite: (id: string, relPath: string, content: string) =>
    invoke<void>(CMD.agentEntityMemoryWrite, { id, relPath, content }),
  memoryDelete: (id: string, relPath: string) =>
    invoke<void>(CMD.agentEntityMemoryDelete, { id, relPath }),
  activity: (id: string) => invoke<AgentActivity>(CMD.agentEntityActivity, { id }),
  proposals: (id: string) => invoke<ProposalInfo[]>(CMD.agentEntityProposals, { id }),
  resolveProposal: (id: string, file: string, approve: boolean, reason?: string) =>
    invoke<void>(CMD.agentEntityProposalResolve, { id, file, approve, reason }),
};

interface EntitiesState {
  entities: AgentEntity[];
  loaded: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (input: AgentEntityInput) => Promise<AgentEntity | null>;
  update: (id: string, input: AgentEntityInput) => Promise<AgentEntity | null>;
  remove: (id: string) => Promise<boolean>;
  byOpencodeName: (name: string | null | undefined) => AgentEntity | undefined;
}

/** Invalidate every cached opencode directory instance, then refresh the
 *  agent catalog. Best-effort: with the sidecar down there is nothing to
 *  invalidate (the next spawn reads the fresh config anyway). Exported for
 *  flows that rewrite an entity OUTSIDE the CRUD here (approving a persona
 *  proposal regenerates the compiled config in Rust). */
export async function hotApplyEntities(): Promise<void> {
  return hotApply();
}

async function hotApply(): Promise<void> {
  const chat = useAgentChatStore.getState();
  const base = chat.baseUrl;
  if (base) {
    try {
      await fetch(`${base}/global/dispose`, { method: "POST" });
    } catch {
      // sidecar unreachable; fresh config lands on next spawn
    }
  }
  void useAgentChatStore.getState().loadAgents();
}

export const useAgentEntitiesStore = create<EntitiesState>((set, get) => ({
  entities: [],
  loaded: false,
  error: null,

  load: async () => {
    try {
      const entities = await invoke<AgentEntity[]>(CMD.agentEntityList);
      set({ entities, loaded: true, error: null });
    } catch (e) {
      // Do NOT mark loaded: syncSelectedEntity treats `loaded && not found`
      // as "agent deleted" and would wipe the persisted selection over a
      // transient IPC failure.
      set({ error: errMessage(e) });
    }
  },

  create: async (input) => {
    try {
      const entity = await invoke<AgentEntity>(CMD.agentEntityCreate, { input });
      set((s) => ({ entities: [...s.entities, entity], error: null }));
      await hotApply();
      return entity;
    } catch (e) {
      set({ error: errMessage(e) });
      return null;
    }
  },

  update: async (id, input) => {
    try {
      const entity = await invoke<AgentEntity>(CMD.agentEntityUpdate, { id, input });
      set((s) => ({
        entities: s.entities.map((e) => (e.id === id ? entity : e)),
        error: null,
      }));
      await hotApply();
      return entity;
    } catch (e) {
      set({ error: errMessage(e) });
      return null;
    }
  },

  remove: async (id) => {
    try {
      await invoke(CMD.agentEntityDelete, { id });
      set((s) => ({ entities: s.entities.filter((e) => e.id !== id), error: null }));
      await hotApply();
      return true;
    } catch (e) {
      set({ error: errMessage(e) });
      return false;
    }
  },

  byOpencodeName: (name) =>
    name ? get().entities.find((e) => e.opencodeName === name) : undefined,
}));

/** The slice of an entity the chat send path needs (mirrored into chat.store). */
export function toSelectedEntity(e: AgentEntity): SelectedEntity {
  return {
    id: e.id,
    name: e.name,
    opencodeName: e.opencodeName,
    permissionPreset: e.permissionPreset,
    ...(e.providerId ? { providerId: e.providerId } : {}),
    ...(e.modelId ? { modelId: e.modelId } : {}),
    ...(e.variant ? { variant: e.variant } : {}),
  };
}

/** Select an entity to drive the chat (null = plain chat): persists the pick
 *  in settings and mirrors the slice into chat.store for the send path. */
export function selectEntityForChat(entity: AgentEntity | null): void {
  useSettingsDataStore.getState().update("agent", { entityId: entity?.id ?? "" });
  useAgentChatStore.getState().setEntity(entity ? toSelectedEntity(entity) : null);
}

// Opening a session from the history re-binds the entity that owns it (the
// chat store reads the session's metadata stamp and calls back here, keeping
// the dependency one-way). `keepSession` skips the new-chat reset, since the
// session being opened IS the one we want.
registerSessionEntityHandler((entityId) => {
  const apply = () => {
    const entity = entityId
      ? (useAgentEntitiesStore.getState().entities.find((e) => e.id === entityId) ?? null)
      : null;
    useSettingsDataStore.getState().update("agent", { entityId: entity?.id ?? "" });
    useAgentChatStore
      .getState()
      .setEntity(entity ? toSelectedEntity(entity) : null, { keepSession: true });
  };
  const st = useAgentEntitiesStore.getState();
  if (entityId && !st.loaded) {
    void st.load().then(apply);
  } else {
    apply();
  }
});

/** Re-resolve the persisted entity pick after a load/refresh: a stale slug
 *  (agent deleted, hand-removed dir) silently clears the selection; an edit
 *  refreshes the mirrored slice so the next turn uses the new model/preset. */
export function syncSelectedEntity(): void {
  const slug = useSettingsDataStore.getState().settings.agent.entityId;
  const current = useAgentChatStore.getState().entity;
  if (!slug) {
    if (current) useAgentChatStore.getState().setEntity(null);
    return;
  }
  const entity = useAgentEntitiesStore.getState().entities.find((e) => e.id === slug);
  if (!entity) {
    if (useAgentEntitiesStore.getState().loaded) selectEntityForChat(null);
    return;
  }
  useAgentChatStore.getState().setEntity(toSelectedEntity(entity));
}
