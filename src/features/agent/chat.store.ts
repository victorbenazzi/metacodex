import { create } from "zustand";

import { CMD, invoke } from "@/lib/ipc";
import { newId } from "@/lib/idGen";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";

import type { RuntimeStatus } from "./runtime.store";
import { applyEvent, clearRoles, mapStoredMessage } from "./chat.events";
import {
  primaryAgentName,
  rulesetForPreset,
  SWARM_ORCHESTRATOR_MODEL_ID,
  SWARM_PROVIDER,
  SWARM_SYSTEM,
  type AgentInfo,
  type PermissionPrompt,
  type PermissionReply,
} from "./opencode";

/**
 * Agent chat over the opencode runtime. The webview talks to `opencode serve`
 * directly (CORS is permissive for the local origin): `fetch` for session +
 * prompt POSTs (all via `ocFetch`), and a single `EventSource` on `/event` whose
 * stream is folded into the thread by `chat.events`. No AI SDK transport — the
 * opencode event bus is the source of truth.
 *
 * Every call is scoped to the active `directory` (the metacodex project the agent
 * works inside) — `ocFetch` threads it as `?directory=`. Without it opencode runs
 * in the sidecar's launch cwd, not the user's project. The session also carries
 * the chosen permission preset (a `PermissionRuleset`); each message carries the
 * primary agent + a swarm system hint.
 */

export type PartType =
  | "text"
  | "reasoning"
  | "tool"
  | "step-start"
  | "step-finish"
  | "file"
  | "patch";

export interface ToolState {
  name?: string;
  status?: string;
  input?: unknown;
  output?: unknown;
  /** opencode's own human-readable label for the call (e.g. a file path). */
  title?: string;
}

export interface ChatPart {
  id: string;
  type: PartType;
  text?: string;
  tool?: ToolState;
  /** Wall-clock window opencode reports for the part (ms epochs) — drives the
   *  "Thought 4s" duration on reasoning. */
  time?: { start?: number; end?: number };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
  finish?: string | null;
}

export interface ChatSessionMeta {
  id: string;
  title: string;
}

/**
 * A subagent session spawned by the orchestrator via the `task` tool (swarm
 * mode). opencode roots it under the main session (`parentID`); we surface its
 * own message stream nested in the thread so delegation is visible, not silent.
 */
export interface ChildSession {
  id: string;
  /** Subagent that runs it (e.g. "explore", "general"). */
  agent: string;
  title: string;
  parentId: string;
  /** Model the subagent runs on (modelID), shown in the card subtitle. */
  model?: string;
  /** Set when the child session goes idle — drives the ✓ vs ⟳ in the card. */
  done?: boolean;
}

export type ChatStatus = "idle" | "submitted" | "streaming";

const DEFAULT_MODEL = "deepseek-v4-flash";

export interface ChatState {
  baseUrl: string | null;
  connected: boolean;
  connecting: boolean;
  /** Project root the agent operates inside; null = opencode's default cwd. */
  directory: string | null;
  /** Primary/subagent catalog for the active directory. */
  agents: AgentInfo[];
  /** Live permission requests awaiting the user's allow/deny. */
  pendingPermissions: PermissionPrompt[];
  sessions: ChatSessionMeta[];
  sessionId: string | null;
  thread: ChatMessage[];
  /** Subagent sessions delegated under the active session (swarm mode). */
  childSessions: ChildSession[];
  /** Per-child message stream, keyed by child session id. */
  childThreads: Record<string, ChatMessage[]>;
  status: ChatStatus;
  error: string | null;

  connect: () => Promise<void>;
  setDirectory: (dir: string | null) => Promise<void>;
  loadAgents: () => Promise<void>;
  newChat: () => void;
  selectSession: (id: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  replyPermission: (id: string, reply: PermissionReply) => Promise<void>;
  /** PATCH the live session's permission ruleset when the preset changes. */
  applyPermissionPreset: () => Promise<void>;
}

export type Get = () => ChatState;
export type Set = (
  partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>),
) => void;

// The `/event` EventSource is non-serializable runtime state — kept outside store.
let eventSource: EventSource | null = null;

/** `?directory=` query string for a path-scoped opencode call. */
function qs(directory: string | null): string {
  return directory ? `?directory=${encodeURIComponent(directory)}` : "";
}

/**
 * One opencode HTTP call, always scoped to the active directory. Resolves the
 * base URL, threads `?directory=`, and JSON-encodes a body when given. The single
 * place the directory invariant is applied, so no session/message call can
 * silently run in the wrong project root.
 */
async function ocFetch(
  get: Get,
  path: string,
  opts: { method?: string; json?: unknown } = {},
): Promise<Response> {
  const base = get().baseUrl;
  if (!base) throw new Error("runtime not connected");
  const init: RequestInit = { method: opts.method ?? "GET" };
  if (opts.json !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(opts.json);
  }
  return fetch(`${base}${path}${qs(get().directory)}`, init);
}

function agentSettings() {
  const a = useSettingsDataStore.getState().settings.agent;
  return {
    providerID: a.providerId || "opencode-go",
    modelID: a.modelId || DEFAULT_MODEL,
    preset: a.permissionPreset,
    mode: a.mode,
  };
}

function openEventStream(base: string, directory: string | null, set: Set, get: Get) {
  eventSource?.close();
  const es = new EventSource(`${base}/event${qs(directory)}`);
  es.onmessage = (e) => {
    try {
      applyEvent(JSON.parse(e.data), get, set);
    } catch {
      // ignore malformed event frames
    }
  };
  es.onerror = () => set({ connected: false });
  es.onopen = () => set({ connected: true });
  eventSource = es;
}

export const useAgentChatStore = create<ChatState>((set, get) => ({
  baseUrl: null,
  connected: false,
  connecting: false,
  directory: null,
  agents: [],
  pendingPermissions: [],
  sessions: [],
  sessionId: null,
  thread: [],
  childSessions: [],
  childThreads: {},
  status: "idle",
  error: null,

  connect: async () => {
    if (get().connected || get().connecting) return;
    set({ connecting: true, error: null });
    try {
      const status = await invoke<RuntimeStatus>(CMD.agentRuntimeStart);
      const base = status.baseUrl;
      if (!base) throw new Error("runtime has no base URL");

      set({ baseUrl: base, connecting: false });
      openEventStream(base, get().directory, set, get);
      void get().loadAgents();
    } catch (e) {
      set({ connecting: false, error: errMessage(e) });
    }
  },

  setDirectory: async (dir) => {
    if (dir === get().directory) return;
    // A session is bound to its directory — switching projects starts fresh.
    clearRoles();
    set({
      directory: dir,
      sessionId: null,
      thread: [],
      childSessions: [],
      childThreads: {},
      pendingPermissions: [],
      status: "idle",
      error: null,
    });
    const base = get().baseUrl;
    if (base) {
      openEventStream(base, dir, set, get);
      void get().loadAgents();
    }
  },

  loadAgents: async () => {
    try {
      const rows: unknown = await (await ocFetch(get, "/agent")).json();
      const agents = Array.isArray(rows)
        ? rows
            .map((r) => r as { name?: string; mode?: AgentInfo["mode"] })
            .filter((r): r is AgentInfo => !!r.name && !!r.mode)
            .map((r) => ({ name: r.name, mode: r.mode }))
        : [];
      set({ agents });
    } catch {
      // agent catalog is best-effort; send() falls back to opencode's default
    }
  },

  newChat: () => {
    clearRoles();
    set({
      sessionId: null,
      thread: [],
      childSessions: [],
      childThreads: {},
      pendingPermissions: [],
      status: "idle",
      error: null,
    });
  },

  selectSession: async (id) => {
    set({
      sessionId: id,
      thread: [],
      childSessions: [],
      childThreads: {},
      pendingPermissions: [],
      status: "idle",
      error: null,
    });
    try {
      const rows: unknown = await (await ocFetch(get, `/session/${id}/message`)).json();
      const thread = Array.isArray(rows) ? rows.map(mapStoredMessage).filter(Boolean) : [];
      set({ thread: thread as ChatMessage[] });
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  send: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!get().connected) await get().connect();

    const cfg = agentSettings();
    const agent = primaryAgentName(get().agents);
    const swarm = cfg.mode === "swarm";
    // Swarm runs the orchestrator on a stronger model (only where it exists —
    // the opencode-go provider); other providers keep the user's pick.
    const modelID =
      swarm && cfg.providerID === SWARM_PROVIDER ? SWARM_ORCHESTRATOR_MODEL_ID : cfg.modelID;

    // Ensure a session exists — created with the chosen permission posture.
    let sessionId = get().sessionId;
    if (!sessionId) {
      try {
        const created = (await (
          await ocFetch(get, "/session", {
            method: "POST",
            json: { permission: rulesetForPreset(cfg.preset, swarm), ...(agent ? { agent } : {}) },
          })
        ).json()) as { id?: string };
        if (!created.id) throw new Error("session create returned no id");
        sessionId = created.id;
        const title = trimmed.slice(0, 48);
        set((s) => ({
          sessionId,
          sessions: [{ id: sessionId as string, title }, ...s.sessions],
        }));
      } catch (e) {
        set({ error: errMessage(e) });
        return;
      }
    }

    // Optimistic user bubble (the server echoes a user message too — the event
    // reducer skips those via roleById and keeps this local one).
    const userMsg: ChatMessage = {
      id: `local-${newId(8)}`,
      role: "user",
      parts: [{ id: `local-${newId(8)}`, type: "text", text: trimmed }],
    };
    set((s) => ({ thread: [...s.thread, userMsg], status: "submitted" }));

    try {
      const res = await ocFetch(get, `/session/${sessionId}/message`, {
        method: "POST",
        json: {
          parts: [{ type: "text", text: trimmed }],
          model: { providerID: cfg.providerID, modelID },
          ...(agent ? { agent } : {}),
          ...(swarm ? { system: SWARM_SYSTEM } : {}),
        },
      });
      if (!res.ok) throw new Error(`prompt failed: HTTP ${res.status}`);
      // The streaming reply arrives via /event; the POST resolves at turn end.
      await res.json().catch(() => undefined);
    } catch (e) {
      set({ error: errMessage(e), status: "idle" });
    }
  },

  stop: async () => {
    const sessionId = get().sessionId;
    if (sessionId) {
      try {
        await ocFetch(get, `/session/${sessionId}/abort`, { method: "POST" });
      } catch {
        // best-effort
      }
    }
    set({ status: "idle" });
  },

  replyPermission: async (id, reply) => {
    const prompt = get().pendingPermissions.find((p) => p.id === id);
    // Optimistically clear the card; the `permission.replied` event confirms.
    set((s) => ({ pendingPermissions: s.pendingPermissions.filter((p) => p.id !== id) }));
    if (!prompt) return;
    try {
      if (prompt.kind === "v2") {
        await ocFetch(get, `/permission/${id}/reply`, { method: "POST", json: { reply } });
      } else {
        const sid = prompt.sessionID || get().sessionId;
        await ocFetch(get, `/session/${sid}/permissions/${id}`, {
          method: "POST",
          json: { response: reply },
        });
      }
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  applyPermissionPreset: async () => {
    if (!get().sessionId) return; // next new chat picks it up at create
    try {
      await ocFetch(get, `/session/${get().sessionId}`, {
        method: "PATCH",
        json: { permission: rulesetForPreset(agentSettings().preset) },
      });
    } catch {
      // best-effort; the preset still applies to the next session
    }
  },
}));

function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
