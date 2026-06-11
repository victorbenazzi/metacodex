import { create } from "zustand";

import { CMD, invoke } from "@/lib/ipc";
import { newId } from "@/lib/idGen";
import i18n from "@/features/i18n/config";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";

import { findModel, useAgentRuntimeStore, type RuntimeStatus } from "./runtime.store";
import { applyEvent, clearRoles, mapStoredMessage, seedRoles } from "./chat.events";
import { loadCommands } from "./commands";
import { errMessage, qs } from "./oc";
import { useAgentSessionsStore } from "./sessions.store";
import { useAgentComposerStore } from "./composer.store";
import { describeImages } from "./visionRelay";
import type { OutgoingPart } from "./attachments";
import {
  applyRevertCut,
  editedFilesFromMessages,
  effectiveModelId,
  mapSessionRevert,
  primaryAgentName,
  rulesetForPreset,
  SWARM_SYSTEM,
  type AgentInfo,
  type PermissionPreset,
  type PermissionPrompt,
  type PermissionReply,
  type QuestionPrompt,
  type SessionRevert,
  type TodoItem,
} from "./opencode";

/**
 * Agent chat over the opencode runtime. The webview talks to `opencode serve`
 * directly (CORS is permissive for the local origin): `fetch` for session +
 * prompt POSTs (all via `ocFetch`), and a single `EventSource` on `/event` whose
 * stream is folded into the thread by `chat.events`. No AI SDK transport: the
 * opencode event bus is the source of truth.
 *
 * Every call is scoped to the active `directory` (the metacodex project the agent
 * works inside); `ocFetch` threads it as `?directory=`. Without it opencode runs
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
  | "patch"
  | "snapshot"
  | "subtask"
  | "agent"
  | "retry"
  | "compaction"
  | "other";

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
  /** File attachment payload (`type === "file"`): mime + name + the data/file
   *  URL, enough to re-render the chip from live events or stored history. */
  file?: { mime?: string; filename?: string; url?: string };
  /** Wall-clock window opencode reports for the part (ms epochs); drives the
   *  "Thought 4s" duration on reasoning and the tool runtime label. */
  time?: { start?: number; end?: number };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
  finish?: string | null;
  /** Total cost in USD opencode reports for the turn (assistant only). */
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    /** Prompt-cache accounting; counts toward context-window usage. */
    cache?: { read?: number; write?: number };
  };
  modelID?: string;
  variant?: string;
  /** Flattened opencode error (provider auth, rate limit, abort...). */
  error?: string;
  /** The images in this message went through the vision relay (described by a
   *  vision model because the chat model can't see). Live-session only. */
  relay?: boolean;
  /** This user message is an inline shell command (the "!" composer mode);
   *  renders mono with a "$" prefix. Live-session only, like `relay`. */
  shell?: boolean;
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
  /** Set when the child session goes idle; drives the done state in the card. */
  done?: boolean;
  /** Set when the child errored (`session.error`). */
  error?: string;
}

export type ChatStatus = "idle" | "submitted" | "streaming";

/** A prompt waiting for the current turn to finish. Parts are materialized at
 *  enqueue time, so each item is self-sufficient and dispatch is just a send. */
export interface QueuedPrompt {
  id: string;
  text: string;
  parts: OutgoingPart[];
}

/** Fallback model when settings carry no explicit pick. Exported so composer
 *  controls (VariantPicker) and the cron dialog resolve the SAME effective
 *  model the send uses. */
export const DEFAULT_MODEL = "deepseek-v4-flash";

/** Minimal slice of an agent entity the send path needs. The full entity
 *  (persona, avatar, projects) lives in entities.store; the composer's
 *  AgentPicker mirrors this slice in via `setEntity`. */
export interface SelectedEntity {
  id: string;
  name: string;
  /** Compiled opencode agent name (`mcx-<slug>`), sent on session + message. */
  opencodeName: string;
  permissionPreset: PermissionPreset;
  providerId?: string;
  modelId?: string;
  variant?: string;
}

export interface ChatState {
  baseUrl: string | null;
  connected: boolean;
  connecting: boolean;
  /** Set only by connection-level failures (start/reconnect), never by message
   *  failures, so a stale send error can't repaint the chat as "runtime down". */
  connectionError: string | null;
  /** Project root the agent operates inside; null = opencode's default cwd. */
  directory: string | null;
  /** Primary/subagent catalog for the active directory. */
  agents: AgentInfo[];
  /** Selected agent ENTITY (persistent agent, see entities.store). Mirrored
   *  here by the composer's AgentPicker so the send path can read it without
   *  importing entities.store (deps stay periphery -> chat.store, one-way).
   *  Null = plain chat with the user's own model/preset picks. */
  entity: SelectedEntity | null;
  /** Live permission requests awaiting allow/deny, for the whole directory
   *  scope; the view filters to the active session + its children. */
  pendingPermissions: PermissionPrompt[];
  /** Live agent questions awaiting an answer (same scoping as permissions). */
  pendingQuestions: QuestionPrompt[];
  /** Agent plan (todo list) per session id, fed by `todo.updated`. */
  todosBySession: Record<string, TodoItem[]>;
  sessionId: string | null;
  thread: ChatMessage[];
  /** True while a selected session's history is loading (skeleton state). */
  threadLoading: boolean;
  /** Subagent sessions delegated under the active session (swarm mode). */
  childSessions: ChildSession[];
  /** Per-child message stream, keyed by child session id. */
  childThreads: Record<string, ChatMessage[]>;
  status: ChatStatus;
  error: string | null;
  /** Text waiting to be injected into the composer (queue restore, edit and
   *  resend). The composer consumes it in an effect and resets it to null;
   *  drafts can't serve this, they only hydrate when no session is active. */
  composerPrefill: string | null;
  /** Active revert checkpoint of the root session (null = none). The thread is
   *  cut at `messageID`; `droppedCount` is display-only (banner wording). */
  revert: (SessionRevert & { droppedCount?: number }) | null;
  /** Files the session's turns touched (edit/write), deduped in first-seen
   *  order: live accumulation via `file.edited`, rehydrated from tool parts
   *  when a historical session reopens. Drives the "N files changed" chip. */
  editedFiles: string[];
  /** Estimated context-window usage of the session, recomputed after each
   *  turn from the last assistant message's token accounting vs the model's
   *  `limit.context`. Null = nothing to show (no turn yet, unknown window). */
  contextUsage: { used: number; limit: number } | null;
  /** True from the summarize POST until `session.compacted` lands (or the
   *  turn errors out), so the compact control can't double-fire. */
  compacting: boolean;
  /** Prompts typed during a running turn, dispatched one per `session.idle`
   *  of the active root session. A failed dispatch pauses the queue with the
   *  item intact; stop/session switch drains it back to the composer. */
  queue: QueuedPrompt[];
  /** Transient line after an "always" permission reply, pointing at the
   *  Customize page where the saved rule can be reviewed/revoked. */
  permissionSavedHint: boolean;

  connect: () => Promise<void>;
  /** Re-point everything at a fresh sidecar base URL after a restart (the
   *  `--port 0` spawn means every restart changes the port). */
  rebindBase: (base: string) => void;
  /** Select/clear the agent entity driving new turns (composer AgentPicker). */
  setEntity: (entity: SelectedEntity | null) => void;
  setDirectory: (dir: string | null) => Promise<void>;
  loadAgents: () => Promise<void>;
  newChat: () => void;
  selectSession: (id: string) => Promise<void>;
  /** Dispatch a prompt (+ optional attachment/context parts). Resolves `true`
   *  once the message is on its way; the reply itself streams via `/event`. */
  send: (text: string, extraParts?: OutgoingPart[]) => Promise<boolean>;
  /** Run a terminal command inside the session (the "!" composer mode); the
   *  output arrives as a normal assistant turn with a bash tool part. */
  sendShell: (command: string) => Promise<boolean>;
  stop: () => Promise<void>;
  replyPermission: (id: string, reply: PermissionReply) => Promise<void>;
  /** Answer an agent question: one array of selected labels per question. */
  replyQuestion: (id: string, answers: string[][]) => Promise<void>;
  rejectQuestion: (id: string) => Promise<void>;
  /** PATCH the live session's permission ruleset when the preset changes. */
  applyPermissionPreset: () => Promise<void>;
  setComposerPrefill: (text: string | null) => void;
  /** Post-turn effects for the ACTIVE root session, invoked only by the
   *  `session.idle` reducer case (root branch). */
  onRootIdle: () => void;
  /** Roll the conversation (and the files on disk) back to before `messageID`.
   *  Resolves true when the revert landed. Idle-only. */
  revertTo: (messageID: string) => Promise<boolean>;
  /** Undo an active revert, restoring the discarded messages + file state. */
  unrevert: () => Promise<void>;
  /** Permanently delete the last user message + the replies after it (no file
   *  rollback; that's what revert is for). Idle-only. */
  deleteLastExchange: () => Promise<void>;
  /** Queue a prompt typed while the agent is busy (parts pre-materialized). */
  enqueue: (text: string, parts: OutgoingPart[]) => void;
  removeQueued: (id: string) => void;
  /** Pull a queued prompt back into the composer (attachments don't survive). */
  editQueued: (id: string) => void;
  /** Recompute `contextUsage` from the current thread (synchronous estimate). */
  refreshContextUsage: () => void;
  /** Compact the conversation via the harness (`POST /summarize`). Idle-only. */
  compact: () => Promise<void>;
  /** `session.compacted` landed for the root: reload the compacted transcript. */
  onSessionCompacted: () => void;
}

export type Get = () => ChatState;
export type Set = (
  partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>),
) => void;

// The `/event` EventSource is non-serializable runtime state, kept outside the store.
let eventSource: EventSource | null = null;

// One timer for the "saved as always-allow" hint; re-arming replaces it.
let savedHintTimer: ReturnType<typeof setTimeout> | null = null;
function flashPermissionSavedHint(set: Set) {
  set({ permissionSavedHint: true });
  if (savedHintTimer) clearTimeout(savedHintTimer);
  savedHintTimer = setTimeout(() => set({ permissionSavedHint: false }), 8000);
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

function agentSettings(entity?: SelectedEntity | null) {
  const a = useSettingsDataStore.getState().settings.agent;
  const base = {
    providerID: a.providerId || "opencode-go",
    modelID: a.modelId || DEFAULT_MODEL,
    preset: a.permissionPreset,
    mode: a.mode,
    /** Compiled entity agent name; undefined = plain chat. */
    agentName: undefined as string | undefined,
    /** Entity-pinned reasoning variant (wins over variantByModel). */
    entityVariant: undefined as string | undefined,
  };
  if (!entity) return base;
  // A selected entity pins model + permission posture; the user's own picks
  // come back the moment the entity is deselected.
  return {
    ...base,
    providerID: entity.providerId || base.providerID,
    modelID: entity.modelId || base.modelID,
    preset: entity.permissionPreset,
    agentName: entity.opencodeName,
    entityVariant: entity.variant,
  };
}

/** Localized error line with the raw detail kept for diagnosis. */
function chatError(key: string, detail?: string): string {
  const label = i18n.t(key);
  return detail ? `${label} (${detail})` : label;
}

/**
 * System block for the next turn: the entity's memory context (home location,
 * memory rules, current indexes; assembled by Rust from the agent home) plus
 * the swarm orchestration hint. Undefined = plain chat, no system override.
 * Best-effort: a context read failure must never block a send.
 */
async function entitySystem(
  entity: SelectedEntity | null,
  directory: string | null,
  swarm: boolean,
): Promise<string | undefined> {
  const blocks: string[] = [];
  if (entity) {
    try {
      const ctx = await invoke<string>(CMD.agentEntityMemoryContext, {
        id: entity.id,
        directory,
      });
      if (ctx.trim()) blocks.push(ctx);
    } catch {
      // memory context is additive; the persona still rides the compiled agent
    }
  }
  if (swarm) blocks.push(SWARM_SYSTEM);
  return blocks.length ? blocks.join("\n\n") : undefined;
}

/**
 * Ensure the active session exists, creating it on demand with the chosen
 * permission posture + primary agent. Returns the session id, or null after
 * flipping back to idle with the failure surfaced. Shared by the plain send,
 * the command dispatch and the inline shell, so session creation can't drift
 * between them.
 */
async function ensureSession(
  get: Get,
  set: Set,
  opts: { preset: PermissionPreset; swarm: boolean; agent?: string },
): Promise<string | null> {
  const existing = get().sessionId;
  if (existing) return existing;
  try {
    const created = (await (
      await ocFetch(get, "/session", {
        method: "POST",
        json: {
          permission: rulesetForPreset(opts.preset, opts.swarm),
          ...(opts.agent ? { agent: opts.agent } : {}),
        },
      })
    ).json()) as { id?: string };
    if (!created.id) throw new Error("session create returned no id");
    set({ sessionId: created.id });
    return created.id;
  } catch (e) {
    set({
      status: "idle",
      error: chatError("agent.chat.errors.sessionCreate", errMessage(e)),
    });
    return null;
  }
}

/**
 * Re-fetch the active session's transcript + revert marker in place, WITHOUT
 * the skeleton state: used after revert/unrevert/compaction, where the thread
 * already renders and a loading flash would be jarring. Stale-guarded like
 * selectSession. The revert cut (hide messages from the revert point on) is
 * applied here, covering sidecars that keep reverted rows in the transcript.
 */
async function refreshThread(get: Get, set: Set): Promise<void> {
  const id = get().sessionId;
  const dir = get().directory;
  if (!id) return;
  const fresh = () => get().sessionId === id && get().directory === dir;
  try {
    const [rowsRes, sessionRes] = await Promise.all([
      ocFetch(get, `/session/${id}/message`),
      ocFetch(get, `/session/${id}`).catch(() => null),
    ]);
    const rows: unknown = await rowsRes.json();
    const sessionInfo = sessionRes
      ? ((await sessionRes.json().catch(() => null)) as { revert?: unknown } | null)
      : null;
    if (!fresh()) return;
    const all = Array.isArray(rows)
      ? (rows.map(mapStoredMessage).filter(Boolean) as ChatMessage[])
      : [];
    const revert = mapSessionRevert(sessionInfo?.revert);
    const thread = applyRevertCut(all, revert);
    seedRoles(all);
    set((s) => ({
      thread,
      editedFiles: editedFilesFromMessages([
        ...thread,
        ...Object.values(s.childThreads).flat(),
      ]),
      revert: revert
        ? {
            ...revert,
            droppedCount:
              all.length > thread.length ? all.length - thread.length : s.revert?.droppedCount,
          }
        : null,
    }));
  } catch {
    // best-effort refresh; the live event stream remains authoritative
  }
}

/** Roll a failed dispatch back: drop the phantom user bubble, surface the
 *  error and keep the text recoverable as the project draft. */
function rollbackSend(
  set: Set,
  userMsgId: string,
  draftText: string,
  directoryAtSend: string | null,
  e: unknown,
) {
  set((s) => ({
    thread: s.thread.filter((m) => m.id !== userMsgId),
    error: chatError("agent.chat.errors.sendFailed", errMessage(e)),
    status: "idle",
  }));
  if (draftText) {
    useAgentSessionsStore.getState().setDraft(directoryAtSend, draftText);
  }
}

// ---- SSE lifecycle + reconnect ----------------------------------------------
//
// EventSource auto-reconnects against the SAME URL, but a sidecar respawn uses
// `--port 0` (new port), so the browser would retry a dead port forever. On
// error we also re-resolve the runtime status via Rust with a small backoff:
// same port back up = reopen, new port = rebind, sidecar gone = restart it.

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
}

function scheduleReconnect(set: Set, get: Get) {
  if (reconnectTimer) return;
  const delays = [2000, 5000, 10000, 15000];
  const delay = delays[Math.min(reconnectAttempt, delays.length - 1)];
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    reconnectAttempt += 1;
    try {
      const status = await invoke<RuntimeStatus>(CMD.agentRuntimeStatus);
      if (status.running && status.baseUrl) {
        if (status.baseUrl !== get().baseUrl) {
          get().rebindBase(status.baseUrl);
        } else {
          openEventStream(status.baseUrl, get().directory, set, get);
        }
        return;
      }
      // Sidecar gone: bring it back up and rebind to the fresh port.
      const started = await invoke<RuntimeStatus>(CMD.agentRuntimeStart);
      if (started.baseUrl) get().rebindBase(started.baseUrl);
    } catch (e) {
      set({ connectionError: errMessage(e) });
      scheduleReconnect(set, get);
    }
  }, delay);
}

function openEventStream(base: string, directory: string | null, set: Set, get: Get) {
  eventSource?.close();
  const es = new EventSource(`${base}/event${qs(directory)}`);
  es.onmessage = (e) => {
    let ev: unknown;
    try {
      ev = JSON.parse(e.data);
    } catch {
      return; // malformed frame
    }
    // Reducer faults must be loud (a silent catch here once swallowed real
    // bugs along with the state they would have applied).
    try {
      applyEvent(ev as { type: string }, get, set);
      // Session lifecycle/status also feeds the per-project history sidebar.
      useAgentSessionsStore.getState().applySessionEvent(ev as { type: string });
    } catch (err) {
      console.error("[agent] event reducer failed", err);
    }
  };
  es.onerror = () => {
    set({ connected: false });
    scheduleReconnect(set, get);
  };
  es.onopen = () => {
    clearReconnect();
    set({ connected: true, connectionError: null });
  };
  eventSource = es;
}

// ---- pending prompts recovery -------------------------------------------------

interface RawPermission {
  id?: string;
  sessionID?: string;
  permission?: string;
  patterns?: string[];
  action?: string;
  resources?: string[];
}

interface RawQuestion {
  id?: string;
  sessionID?: string;
  questions?: QuestionPrompt["questions"];
}

/** Re-fetch outstanding permission/question requests from the sidecar, so a
 *  pending ask survives a session switch (the SSE event is long gone). Both
 *  API generations are queried; 404s from older sidecars are ignored. */
async function fetchPendingPrompts(
  get: Get,
): Promise<{ permissions: PermissionPrompt[]; questions: QuestionPrompt[] }> {
  const permissions: PermissionPrompt[] = [];
  const questions: QuestionPrompt[] = [];
  const seen = new Set<string>();

  const tryJson = async (path: string): Promise<unknown> => {
    try {
      const res = await ocFetch(get, path);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const v1 = (await tryJson("/permission")) as RawPermission[] | null;
  for (const p of v1 ?? []) {
    if (!p?.id || !p.sessionID || seen.has(p.id)) continue;
    seen.add(p.id);
    permissions.push({
      id: p.id,
      sessionID: p.sessionID,
      kind: "v1",
      action: p.permission ?? "action",
      targets: Array.isArray(p.patterns) ? p.patterns : [],
    });
  }
  const v2 = (await tryJson("/api/permission/request")) as RawPermission[] | null;
  for (const p of v2 ?? []) {
    if (!p?.id || !p.sessionID || seen.has(p.id)) continue;
    seen.add(p.id);
    permissions.push({
      id: p.id,
      sessionID: p.sessionID,
      kind: "v2",
      action: p.action ?? "action",
      targets: Array.isArray(p.resources) ? p.resources : [],
    });
  }

  const q1 = (await tryJson("/question")) as RawQuestion[] | null;
  for (const q of q1 ?? []) {
    if (!q?.id || !q.sessionID || seen.has(q.id)) continue;
    seen.add(q.id);
    if (Array.isArray(q.questions) && q.questions.length > 0) {
      questions.push({ id: q.id, sessionID: q.sessionID, kind: "v1", questions: q.questions });
    }
  }
  const q2 = (await tryJson("/api/question/request")) as RawQuestion[] | null;
  for (const q of q2 ?? []) {
    if (!q?.id || !q.sessionID || seen.has(q.id)) continue;
    seen.add(q.id);
    if (Array.isArray(q.questions) && q.questions.length > 0) {
      questions.push({ id: q.id, sessionID: q.sessionID, kind: "v2", questions: q.questions });
    }
  }

  return { permissions, questions };
}

/** Cap on swarm children fetched when reopening a historical session. */
const MAX_CHILD_FETCH = 12;

export const useAgentChatStore = create<ChatState>((set, get) => ({
  baseUrl: null,
  connected: false,
  connecting: false,
  connectionError: null,
  directory: null,
  agents: [],
  entity: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todosBySession: {},
  sessionId: null,
  thread: [],
  threadLoading: false,
  childSessions: [],
  childThreads: {},
  status: "idle",
  error: null,
  composerPrefill: null,
  revert: null,
  editedFiles: [],
  contextUsage: null,
  compacting: false,
  queue: [],
  permissionSavedHint: false,

  connect: async () => {
    if (get().connected || get().connecting) return;
    set({ connecting: true, connectionError: null });
    try {
      const status = await invoke<RuntimeStatus>(CMD.agentRuntimeStart);
      const base = status.baseUrl;
      if (!base) throw new Error("runtime has no base URL");

      set({ baseUrl: base, connecting: false });
      useAgentSessionsStore.getState().setBaseUrl(base);
      openEventStream(base, get().directory, set, get);
      void get().loadAgents();
    } catch (e) {
      set({ connecting: false, connectionError: errMessage(e) });
    }
  },

  rebindBase: (base) => {
    // `connected` flips on the stream's own onopen; claiming it here would lie
    // for the window where the new socket hasn't opened yet.
    set({ baseUrl: base, connecting: false, connectionError: null });
    useAgentSessionsStore.getState().setBaseUrl(base);
    openEventStream(base, get().directory, set, get);
    void get().loadAgents();
  },

  setEntity: (entity) => {
    const changed = (entity?.id ?? null) !== (get().entity?.id ?? null);
    // Same-id calls still land: an edit may have changed model/preset/variant.
    set({ entity });
    // A session is created with its agent + permission posture; switching the
    // entity mid-thread would silently mix personas, so the next turn starts
    // a fresh session (same rule as switching the project).
    if (changed && get().sessionId) get().newChat();
  },

  setDirectory: async (dir) => {
    if (dir === get().directory) return;
    // A session is bound to its directory; switching projects starts fresh.
    clearRoles();
    // Attachments are project-scoped; never carry chips across a switch.
    useAgentComposerStore.getState().clear();
    set({
      directory: dir,
      sessionId: null,
      thread: [],
      threadLoading: false,
      childSessions: [],
      childThreads: {},
      pendingPermissions: [],
      pendingQuestions: [],
      todosBySession: {},
      status: "idle",
      error: null,
      composerPrefill: null,
      revert: null,
      editedFiles: [],
      contextUsage: null,
      compacting: false,
      queue: [],
      permissionSavedHint: false,
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
    // Directory-wide pending prompts stay: they belong to other sessions and
    // the view filters by the active one anyway.
    set({
      sessionId: null,
      thread: [],
      threadLoading: false,
      childSessions: [],
      childThreads: {},
      status: "idle",
      error: null,
      revert: null,
      editedFiles: [],
      contextUsage: null,
      compacting: false,
      queue: [],
    });
  },

  selectSession: async (id) => {
    clearRoles();
    set({
      sessionId: id,
      thread: [],
      threadLoading: true,
      childSessions: [],
      childThreads: {},
      status: "idle",
      error: null,
      revert: null,
      editedFiles: [],
      contextUsage: null,
      compacting: false,
      queue: [],
    });
    // Everything below is stale-guarded: the user may click another session
    // (or switch projects) while these fetches are in flight, and a late
    // response must never paint under the newer selection.
    const fresh = () => get().sessionId === id;
    try {
      // The session object (revert marker) is best-effort: its failure must
      // never block the transcript itself.
      const [rowsRes, sessionRes] = await Promise.all([
        ocFetch(get, `/session/${id}/message`),
        ocFetch(get, `/session/${id}`).catch(() => null),
      ]);
      const rows: unknown = await rowsRes.json();
      const sessionInfo = sessionRes
        ? ((await sessionRes.json().catch(() => null)) as { revert?: unknown } | null)
        : null;
      if (!fresh()) return;
      const all = Array.isArray(rows)
        ? (rows.map(mapStoredMessage).filter(Boolean) as ChatMessage[])
        : [];
      // An active revert hides the rolled-back tail of the transcript; roles
      // are seeded for ALL rows so an unrevert never misclassifies an echo.
      const revert = mapSessionRevert(sessionInfo?.revert);
      const thread = applyRevertCut(all, revert);
      seedRoles(all);
      set({
        thread,
        threadLoading: false,
        // Derived from the VISIBLE thread: files touched only by reverted
        // turns are rolled back and must not count.
        editedFiles: editedFilesFromMessages(thread),
        revert: revert
          ? {
              ...revert,
              ...(all.length > thread.length
                ? { droppedCount: all.length - thread.length }
                : {}),
            }
          : null,
      });

      // Swarm children: reopening a historical session must show delegation,
      // not just the orchestrator transcript.
      const childRows: unknown = await (await ocFetch(get, `/session/${id}/children`)).json();
      if (!fresh()) return;
      if (Array.isArray(childRows)) {
        const children: ChildSession[] = (childRows as Array<Record<string, unknown>>)
          .slice(0, MAX_CHILD_FETCH)
          .map((c) => ({
            id: String(c.id ?? ""),
            agent: typeof c.agent === "string" && c.agent ? c.agent : "subagent",
            title: typeof c.title === "string" ? c.title : "",
            parentId: id,
            model: (c.model as { modelID?: string } | undefined)?.modelID,
            done: true,
          }))
          .filter((c) => c.id);
        if (children.length > 0) {
          const childThreads: Record<string, ChatMessage[]> = {};
          await Promise.all(
            children.map(async (child) => {
              try {
                const msgs: unknown = await (
                  await ocFetch(get, `/session/${child.id}/message`)
                ).json();
                childThreads[child.id] = Array.isArray(msgs)
                  ? (msgs.map(mapStoredMessage).filter(Boolean) as ChatMessage[])
                  : [];
              } catch {
                childThreads[child.id] = [];
              }
            }),
          );
          if (!fresh()) return;
          set((s) => ({
            childSessions: children,
            childThreads,
            // Subagent edits count toward the session's touched files.
            editedFiles: editedFilesFromMessages([
              ...s.thread,
              ...Object.values(childThreads).flat(),
            ]),
          }));
        }
      }

      // Outstanding prompts + the agent's plan: the SSE events that announced
      // them are long gone, so they must be re-fetched, or a pending ask
      // becomes permanently invisible after a session switch.
      const [pending, todosRows] = await Promise.all([
        fetchPendingPrompts(get),
        (async () => {
          try {
            const res = await ocFetch(get, `/session/${id}/todo`);
            return res.ok ? ((await res.json()) as TodoItem[]) : null;
          } catch {
            return null;
          }
        })(),
      ]);
      if (!fresh()) return;
      set((s) => ({
        pendingPermissions: pending.permissions,
        pendingQuestions: pending.questions,
        todosBySession: Array.isArray(todosRows)
          ? { ...s.todosBySession, [id]: todosRows }
          : s.todosBySession,
        // A pending ask means the turn is still blocked on the user.
        status: pending.permissions.some((p) => p.sessionID === id) ||
          pending.questions.some((q) => q.sessionID === id)
          ? "submitted"
          : s.status,
      }));
      // A reopened session shows its meter without needing a fresh turn.
      get().refreshContextUsage();
    } catch (e) {
      if (fresh()) set({ error: errMessage(e), threadLoading: false });
    }
  },

  send: async (text, extraParts = []) => {
    const trimmed = text.trim();
    if (!trimmed && extraParts.length === 0) return false;
    // Single-flight: the busy flag must flip BEFORE any await, or a second
    // Enter in the session-create window splits the message into two sessions.
    if (get().status !== "idle") return false;
    set({ status: "submitted", error: null });

    if (!get().connected) await get().connect();

    const cfg = agentSettings(get().entity);
    const agent = cfg.agentName ?? primaryAgentName(get().agents);
    const swarm = cfg.mode === "swarm";
    // Swarm runs the orchestrator on a stronger model (only where it exists:
    // the opencode-go provider); other providers keep the user's pick.
    const modelID = effectiveModelId(cfg.providerID, cfg.modelID, cfg.mode);

    // Ensure a session exists, created with the chosen permission posture.
    const sessionId = await ensureSession(get, set, { preset: cfg.preset, swarm, agent });
    if (!sessionId) return false;

    // Vision relay: data-URL images headed to a model that can't see them get
    // described by a vision model first; the description replaces the images.
    // Unknown catalog entries are assumed capable: opencode decides then.
    const imageParts = extraParts.filter(
      (p) => p.type === "file" && p.mime.startsWith("image/") && p.url.startsWith("data:"),
    );
    const activeModel = findModel(useAgentRuntimeStore.getState().providers, cfg.providerID, modelID);
    const needsRelay = imageParts.length > 0 && activeModel !== null && !activeModel.attachment;

    // Reasoning-effort variant for the EFFECTIVE model (swarm may have swapped
    // it); only sent when the catalog confirms the model exposes that variant.
    // An entity-pinned variant wins over the user's per-model memory.
    const chosenVariant =
      cfg.entityVariant ||
      useSettingsDataStore.getState().settings.agent.variantByModel[
        `${cfg.providerID}/${modelID}`
      ];
    const variant =
      chosenVariant && activeModel?.variants.includes(chosenVariant) ? chosenVariant : undefined;

    // "/name args" matching a harness command runs through the command
    // endpoint (server-side template expansion, the TUI behavior). Attachments
    // force the plain message path: the command body only takes file parts and
    // context chips are text parts; dropping them silently would be worse.
    const slash = trimmed.match(/^\/(\S+)([\s\S]*)$/);
    if (slash && extraParts.length === 0) {
      const base = get().baseUrl;
      const cmds = base ? await loadCommands(base, get().directory) : [];
      const cmd = cmds.find((c) => c.name === slash[1]);
      if (cmd) {
        const userMsg: ChatMessage = {
          id: `local-${newId(8)}`,
          role: "user",
          parts: [{ id: `local-${newId(8)}`, type: "text", text: trimmed }],
        };
        set((s) => ({ thread: [...s.thread, userMsg], error: null }));
        useAgentSessionsStore.getState().markRunning(sessionId);
        const directoryAtSend = get().directory;
        void ocFetch(get, `/session/${sessionId}/command`, {
          method: "POST",
          json: {
            command: cmd.name,
            arguments: slash[2].trim(),
            // The command's own pinned model wins; otherwise ride the active
            // pick ("provider/model" flat string in this body).
            ...(cmd.model ? {} : { model: `${cfg.providerID}/${modelID}` }),
            ...(variant ? { variant } : {}),
          },
        })
          .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await res.json().catch(() => undefined);
          })
          .catch((e) => {
            rollbackSend(set, userMsg.id, trimmed, directoryAtSend, e);
          });
        return true;
      }
    }

    // Optimistic user bubble (the server echoes a user message too; the event
    // reducer skips those via roleById and keeps this local one). Attachment
    // parts ride along so the chips render immediately.
    const userParts: ChatPart[] = extraParts.map((p) =>
      p.type === "file"
        ? {
            id: `local-${newId(8)}`,
            type: "file" as const,
            file: { mime: p.mime, filename: p.filename, url: p.url },
          }
        : { id: `local-${newId(8)}`, type: "text" as const, text: p.text },
    );
    if (trimmed) userParts.push({ id: `local-${newId(8)}`, type: "text", text: trimmed });
    const userMsg: ChatMessage = {
      id: `local-${newId(8)}`,
      role: "user",
      parts: userParts,
      ...(needsRelay ? { relay: true } : {}),
    };
    set((s) => ({ thread: [...s.thread, userMsg], error: null }));
    // Light the sidebar dot immediately; session.status/idle events settle it.
    useAgentSessionsStore.getState().markRunning(sessionId);

    let outgoing = extraParts;
    if (needsRelay) {
      const base = get().baseUrl;
      const relay = base
        ? await describeImages(base, get().directory, imageParts)
        : ({ ok: false, error: "relay-failed" } as const);
      if (!relay.ok) {
        // Roll the optimistic bubble back so the composer (which kept its
        // chips) is the single copy of the unsent message.
        set((s) => ({
          thread: s.thread.filter((m) => m.id !== userMsg.id),
          status: "idle",
          error: i18n.t(
            relay.error === "no-vision-model"
              ? "agent.chat.visionRelayNoModel"
              : "agent.chat.visionRelayFailed",
          ),
        }));
        return false;
      }
      // File parts stay FIRST (opencode convention); the synthetic description
      // rides just before the user's text.
      outgoing = [
        ...extraParts.filter((p) => !imageParts.includes(p)),
        { type: "text", text: `[Image description via vision relay]\n${relay.description}` },
      ];
    }

    // The POST resolves only at turn end (the reply streams via /event), so it
    // runs detached; `send` resolves as soon as the message is dispatched.
    const directoryAtSend = get().directory;
    const system = await entitySystem(get().entity, directoryAtSend, swarm);
    void ocFetch(get, `/session/${sessionId}/message`, {
      method: "POST",
      json: {
        parts: [
          ...outgoing,
          ...(trimmed ? [{ type: "text", text: trimmed }] : []),
        ],
        model: { providerID: cfg.providerID, modelID },
        ...(variant ? { variant } : {}),
        ...(agent ? { agent } : {}),
        ...(system ? { system } : {}),
      },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.json().catch(() => undefined);
      })
      .catch((e) => {
        // The composer already cleared itself; roll the phantom bubble back and
        // keep the text recoverable as the project draft.
        rollbackSend(set, userMsg.id, trimmed, directoryAtSend, e);
      });
    return true;
  },

  sendShell: async (command) => {
    const trimmed = command.trim();
    if (!trimmed) return false;
    // Same single-flight rule as send (flip before any await).
    if (get().status !== "idle") return false;
    set({ status: "submitted", error: null });

    if (!get().connected) await get().connect();

    const cfg = agentSettings(get().entity);
    const agent = cfg.agentName ?? primaryAgentName(get().agents);
    const swarm = cfg.mode === "swarm";
    const modelID = effectiveModelId(cfg.providerID, cfg.modelID, cfg.mode);

    const sessionId = await ensureSession(get, set, { preset: cfg.preset, swarm, agent });
    if (!sessionId) return false;

    const userMsg: ChatMessage = {
      id: `local-${newId(8)}`,
      role: "user",
      shell: true,
      parts: [{ id: `local-${newId(8)}`, type: "text", text: trimmed }],
    };
    set((s) => ({ thread: [...s.thread, userMsg], error: null }));
    useAgentSessionsStore.getState().markRunning(sessionId);

    const directoryAtSend = get().directory;
    void ocFetch(get, `/session/${sessionId}/shell`, {
      method: "POST",
      json: {
        command: trimmed,
        // `agent` is REQUIRED by this body; "build" is opencode's default
        // primary when the catalog hasn't loaded yet.
        agent: agent ?? "build",
        model: { providerID: cfg.providerID, modelID },
      },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.json().catch(() => undefined);
      })
      .catch((e) => {
        // The "!" goes back with the draft so resending is one Enter away.
        rollbackSend(set, userMsg.id, `!${trimmed}`, directoryAtSend, e);
      });
    return true;
  },

  stop: async () => {
    const sessionId = get().sessionId;
    // A stop also cancels what's queued; the text returns to the composer so
    // nothing typed is lost (attachments don't survive, same rule as drafts).
    const queued = get().queue;
    if (queued.length > 0) {
      const joined = queued
        .map((q) => q.text)
        .filter(Boolean)
        .join("\n\n");
      set({ queue: [] });
      if (joined) {
        get().setComposerPrefill(joined);
        if (!sessionId) {
          useAgentSessionsStore.getState().setDraft(get().directory, joined);
        }
      }
    }
    if (sessionId) {
      try {
        await ocFetch(get, `/session/${sessionId}/abort`, { method: "POST" });
      } catch {
        // best-effort
      }
    }
    // An aborted turn can no longer be approved/answered; dead cards would 4xx.
    set((s) => ({
      status: "idle",
      pendingPermissions: s.pendingPermissions.filter((p) => p.sessionID !== sessionId),
      pendingQuestions: s.pendingQuestions.filter((q) => q.sessionID !== sessionId),
    }));
  },

  replyPermission: async (id, reply) => {
    const prompt = get().pendingPermissions.find((p) => p.id === id);
    if (!prompt) return;
    // Optimistically clear the card; restored if the POST doesn't land.
    set((s) => ({ pendingPermissions: s.pendingPermissions.filter((p) => p.id !== id) }));
    const restore = () =>
      set((s) =>
        s.pendingPermissions.some((p) => p.id === id)
          ? {}
          : { pendingPermissions: [...s.pendingPermissions, prompt] },
      );
    try {
      const res =
        prompt.kind === "v2"
          ? await ocFetch(get, `/permission/${id}/reply`, { method: "POST", json: { reply } })
          : await ocFetch(get, `/session/${prompt.sessionID}/permissions/${id}`, {
              method: "POST",
              json: { response: reply },
            });
      if (!res.ok) {
        restore();
        set({ error: chatError("agent.chat.errors.permissionReply", `HTTP ${res.status}`) });
      } else if (reply === "always") {
        // "Always" persisted an invisible rule; point at where to review it.
        flashPermissionSavedHint(set);
      }
    } catch (e) {
      restore();
      set({ error: chatError("agent.chat.errors.permissionReply", errMessage(e)) });
    }
  },

  replyQuestion: async (id, answers) => {
    const prompt = get().pendingQuestions.find((q) => q.id === id);
    if (!prompt) return;
    set((s) => ({ pendingQuestions: s.pendingQuestions.filter((q) => q.id !== id) }));
    const restore = () =>
      set((s) =>
        s.pendingQuestions.some((q) => q.id === id)
          ? {}
          : { pendingQuestions: [...s.pendingQuestions, prompt] },
      );
    try {
      const res =
        prompt.kind === "v2"
          ? await ocFetch(
              get,
              `/api/session/${prompt.sessionID}/question/request/${id}/reply`,
              { method: "POST", json: { answers } },
            )
          : await ocFetch(get, `/question/${id}/reply`, { method: "POST", json: { answers } });
      if (!res.ok) {
        restore();
        set({ error: chatError("agent.chat.errors.questionReply", `HTTP ${res.status}`) });
      }
    } catch (e) {
      restore();
      set({ error: chatError("agent.chat.errors.questionReply", errMessage(e)) });
    }
  },

  rejectQuestion: async (id) => {
    const prompt = get().pendingQuestions.find((q) => q.id === id);
    if (!prompt) return;
    set((s) => ({ pendingQuestions: s.pendingQuestions.filter((q) => q.id !== id) }));
    try {
      const res =
        prompt.kind === "v2"
          ? await ocFetch(
              get,
              `/api/session/${prompt.sessionID}/question/request/${id}/reject`,
              { method: "POST", json: {} },
            )
          : await ocFetch(get, `/question/${id}/reject`, { method: "POST", json: {} });
      if (!res.ok) {
        set({ error: chatError("agent.chat.errors.questionReply", `HTTP ${res.status}`) });
      }
    } catch (e) {
      set({ error: chatError("agent.chat.errors.questionReply", errMessage(e)) });
    }
  },

  applyPermissionPreset: async () => {
    if (!get().sessionId) return; // next new chat picks it up at create
    const cfg = agentSettings(get().entity);
    try {
      await ocFetch(get, `/session/${get().sessionId}`, {
        method: "PATCH",
        // Keep the swarm `task: allow` rule when the session runs in swarm
        // mode, or a mid-session preset change stalls delegation.
        json: { permission: rulesetForPreset(cfg.preset, cfg.mode === "swarm") },
      });
    } catch {
      // best-effort; the preset still applies to the next session
    }
  },

  setComposerPrefill: (text) => set({ composerPrefill: text }),

  onRootIdle: () => {
    // Post-turn effects for the active root session land here (wired once from
    // the `session.idle` reducer): context-usage refresh and queued-prompt
    // dispatch plug in via their features.
    get().refreshContextUsage();

    // Queue dispatch. `session.idle` never fires with a pending card, but the
    // explicit pending check also covers the selectSession recovery path and
    // any future reordering. The send's single-flight (status flips before any
    // await) makes a duplicate idle harmless.
    const { queue, status, sessionId, pendingPermissions, pendingQuestions } = get();
    if (queue.length === 0 || status !== "idle") return;
    const blocked =
      pendingPermissions.some((p) => p.sessionID === sessionId) ||
      pendingQuestions.some((q) => q.sessionID === sessionId);
    if (blocked) return;
    const head = queue[0];
    void get()
      .send(head.text, head.parts)
      .then((ok) => {
        // Remove the head ONLY once its send dispatched; a failure pauses the
        // queue with the item intact (never skip, never reorder).
        if (ok) set((s) => ({ queue: s.queue.filter((q) => q.id !== head.id) }));
      });
  },

  enqueue: (text, parts) => {
    const trimmed = text.trim();
    if (!trimmed && parts.length === 0) return;
    set((s) => ({ queue: [...s.queue, { id: `q-${newId(8)}`, text: trimmed, parts }] }));
    // The turn may have settled while the chips were being materialized; an
    // idle session drains immediately instead of waiting for another turn.
    if (get().status === "idle") get().onRootIdle();
  },

  removeQueued: (id) => {
    set((s) => ({ queue: s.queue.filter((q) => q.id !== id) }));
  },

  editQueued: (id) => {
    const item = get().queue.find((q) => q.id === id);
    if (!item) return;
    set((s) => ({ queue: s.queue.filter((q) => q.id !== id) }));
    if (item.text) get().setComposerPrefill(item.text);
  },

  deleteLastExchange: async () => {
    const sessionId = get().sessionId;
    if (get().status !== "idle" || !sessionId) return;
    const thread = get().thread;
    let lastUserIdx = -1;
    for (let i = thread.length - 1; i >= 0; i--) {
      if (thread[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;
    const targets = thread.slice(lastUserIdx).filter((m) => !m.id.startsWith("local-"));
    try {
      // Assistants first, the user message last: a mid-flight failure leaves
      // an unanswered question, never an orphaned answer. (The DELETE removes
      // one message + its parts and does NOT cascade; verified on the spec.)
      for (const m of [...targets].reverse()) {
        const res = await ocFetch(get, `/session/${sessionId}/message/${m.id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      // `message.removed` events clear the thread; refresh converges anyway.
      void refreshThread(get, set);
    } catch (e) {
      set({ error: chatError("agent.chat.errors.deleteFailed", errMessage(e)) });
      void refreshThread(get, set);
    }
  },

  refreshContextUsage: () => {
    if (!get().sessionId) {
      set({ contextUsage: null });
      return;
    }
    // Pure estimate: the sidecar exposes no usage endpoint (verified against
    // the 1.16 spec), but every assistant message carries its full token
    // accounting, and cache reads/writes occupy the window like fresh input.
    const lastAssistant = [...get().thread]
      .reverse()
      .find((m) => m.role === "assistant" && m.tokens);
    const tk = lastAssistant?.tokens;
    if (!tk) {
      set({ contextUsage: null });
      return;
    }
    const used =
      (tk.input ?? 0) +
      (tk.output ?? 0) +
      (tk.reasoning ?? 0) +
      (tk.cache?.read ?? 0) +
      (tk.cache?.write ?? 0);
    const cfg = agentSettings(get().entity);
    const modelID =
      lastAssistant?.modelID ?? effectiveModelId(cfg.providerID, cfg.modelID, cfg.mode);
    const limit = findModel(useAgentRuntimeStore.getState().providers, cfg.providerID, modelID)
      ?.limit?.context;
    // Any missing piece (unknown model, no window in the catalog) simply hides
    // the meter; the estimate must never break the chat.
    set({ contextUsage: used > 0 && limit ? { used, limit } : null });
  },

  compact: async () => {
    const sessionId = get().sessionId;
    if (get().status !== "idle" || get().compacting || !sessionId) return;
    set({ compacting: true });
    const cfg = agentSettings();
    const modelID = effectiveModelId(cfg.providerID, cfg.modelID, cfg.mode);
    try {
      const res = await ocFetch(get, `/session/${sessionId}/summarize`, {
        method: "POST",
        json: { providerID: cfg.providerID, modelID },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // `session.compacted` (or a root idle/error) settles the flag.
    } catch (e) {
      set({
        compacting: false,
        error: chatError("agent.chat.errors.compactFailed", errMessage(e)),
      });
    }
  },

  onSessionCompacted: () => {
    set({ compacting: false });
    // Reload the compacted transcript (the `compaction` divider renders from
    // history) and re-measure against the smaller context.
    void refreshThread(get, set).then(() => get().refreshContextUsage());
  },

  revertTo: async (messageID) => {
    const sessionId = get().sessionId;
    // Idle-only: reverting under a live stream would fight the reducer; the
    // hover actions are hidden then, this is the backstop. `local-` ids mean
    // the server echo hasn't adopted the bubble yet (no real id to revert to).
    if (get().status !== "idle" || !sessionId || messageID.startsWith("local-")) return false;
    try {
      const res = await ocFetch(get, `/session/${sessionId}/revert`, {
        method: "POST",
        json: { messageID },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // The response is the updated Session; fold its marker right away so the
      // banner appears without waiting for `session.updated`.
      const session = (await res.json().catch(() => null)) as { revert?: unknown } | null;
      const revert = mapSessionRevert(session?.revert) ?? { messageID };
      const idx = get().thread.findIndex((m) => m.id === messageID);
      set((s) => ({
        revert: {
          ...revert,
          ...(idx === -1 ? {} : { droppedCount: s.thread.length - idx }),
        },
      }));
      // Server-side `message.removed` events may also arrive; the refresh
      // converges the transcript either way (and applies the revert cut).
      void refreshThread(get, set);
      return true;
    } catch (e) {
      set({ error: chatError("agent.chat.errors.revertFailed", errMessage(e)) });
      return false;
    }
  },

  unrevert: async () => {
    const sessionId = get().sessionId;
    if (get().status !== "idle" || !sessionId || !get().revert) return;
    try {
      const res = await ocFetch(get, `/session/${sessionId}/unrevert`, {
        method: "POST",
        json: {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ revert: null });
      // The restored messages come back via the re-fetch, not via events.
      await refreshThread(get, set);
    } catch (e) {
      set({ error: chatError("agent.chat.errors.unrevertFailed", errMessage(e)) });
    }
  },
}));
