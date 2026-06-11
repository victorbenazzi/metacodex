import type {
  ChatMessage,
  ChatPart,
  ChatState,
  ChildSession,
  Get,
  PartType,
  Set,
} from "./chat.store";
import {
  mapSessionRevert,
  type PermissionPrompt,
  type QuestionInfo,
  type QuestionPrompt,
  type TodoItem,
} from "./opencode";

/**
 * Event-folding layer for the agent chat. Pure reducers that turn the opencode
 * SSE stream (and stored-message history) into the renderable thread model. Kept
 * out of the store so the store stays about transport + state; everything here is
 * a `(get, set)`-driven mutation over the thread, with no I/O.
 *
 * This file is deliberately the ONLY place that knows opencode's event names
 * and payload shapes, so a future migration to the v2 event stream
 * (`/api/event`, `session.next.*`) stays confined here.
 */

// Maps an opencode messageID to its role so the reducer can drop the server's
// echo of the user's message (we render an optimistic local bubble instead).
const roleById = new Map<string, "user" | "assistant">();

/** Reset the role map (thread cleared: new chat / project switch). */
export function clearRoles() {
  roleById.clear();
}

/** Seed the role map from freshly loaded history rows, so a part event that
 *  races ahead of its `message.updated` can't fabricate the user's own text as
 *  an assistant bubble. */
export function seedRoles(messages: ChatMessage[]) {
  for (const m of messages) roleById.set(m.id, m.role);
}

interface OcEvent {
  type: string;
  properties?: Record<string, unknown>;
}

interface OcPart {
  id: string;
  type: string;
  text?: string;
  messageID?: string;
  sessionID?: string;
  tool?: string;
  mime?: string;
  filename?: string;
  url?: string;
  time?: { start?: number; end?: number };
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    title?: string;
    time?: { start?: number; end?: number };
  };
}

/** Part types the thread model understands; anything else maps to "other"
 *  (rendered as nothing, but never silently mistyped). */
const KNOWN_PART_TYPES: readonly PartType[] = [
  "text",
  "reasoning",
  "tool",
  "step-start",
  "step-finish",
  "file",
  "patch",
  "snapshot",
  "subtask",
  "agent",
  "retry",
  "compaction",
];

function partType(t: string | undefined): PartType {
  return t && (KNOWN_PART_TYPES as readonly string[]).includes(t) ? (t as PartType) : "other";
}

/**
 * Resolve which thread an event for `evSessionID` belongs to: the active root
 * session, a known swarm child session, or neither (drop). Permission and
 * question events go through this too: a subagent's ask must surface, or the
 * whole delegation stalls on a card that never renders.
 */
type Target = { kind: "root" } | { kind: "child"; id: string } | null;
function resolveTarget(get: Get, evSessionID: string | undefined): Target {
  const root = get().sessionId;
  if (!root || !evSessionID) return null;
  if (evSessionID === root) return { kind: "root" };
  if (get().childSessions.some((c) => c.id === evSessionID)) return { kind: "child", id: evSessionID };
  return null;
}

/** Strip undefined-valued keys, so merging a partial snapshot over accumulated
 *  part state can't clobber fields the snapshot didn't carry. */
function defined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/** Assistant-message metadata carried by `message.updated` and history rows. */
interface AssistantMeta {
  finish?: string | null;
  cost?: number;
  tokens?: ChatMessage["tokens"];
  modelID?: string;
  variant?: string;
  /** Flattened opencode error (name + message), shown inline in the thread. */
  error?: string;
}

function metaFromInfo(info: Record<string, unknown> | undefined): AssistantMeta {
  if (!info) return {};
  const meta: AssistantMeta = {};
  if (typeof info.finish === "string") meta.finish = info.finish;
  if (typeof info.cost === "number") meta.cost = info.cost;
  if (typeof info.modelID === "string") meta.modelID = info.modelID;
  if (typeof info.variant === "string") meta.variant = info.variant;
  const tokens = info.tokens as
    | {
        input?: number;
        output?: number;
        reasoning?: number;
        cache?: { read?: number; write?: number };
      }
    | undefined;
  if (tokens && typeof tokens === "object") {
    meta.tokens = {
      input: typeof tokens.input === "number" ? tokens.input : undefined,
      output: typeof tokens.output === "number" ? tokens.output : undefined,
      reasoning: typeof tokens.reasoning === "number" ? tokens.reasoning : undefined,
      // Cache reads/writes occupy the context window too; the meter needs them.
      cache:
        tokens.cache && typeof tokens.cache === "object"
          ? {
              read: typeof tokens.cache.read === "number" ? tokens.cache.read : undefined,
              write: typeof tokens.cache.write === "number" ? tokens.cache.write : undefined,
            }
          : undefined,
    };
  }
  const err = flattenError(info.error);
  if (err) meta.error = err;
  return meta;
}

/** opencode errors are `{ name, data: { message } }` unions; flatten to text. */
export function flattenError(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as { name?: string; data?: { message?: string } };
  const message = e.data?.message;
  if (message && e.name) return `${e.name}: ${message}`;
  return message || e.name || null;
}

/** Fold one opencode event into the thread / pending-prompt state. */
export function applyEvent(ev: OcEvent, get: Get, set: Set) {
  const props = ev.properties ?? {};
  const sessionId = get().sessionId;

  switch (ev.type) {
    case "session.created":
    case "session.updated": {
      const info = props.info as
        | {
            id?: string;
            parentID?: string;
            agent?: string;
            title?: string;
            model?: { modelID?: string };
            revert?: unknown;
          }
        | undefined;
      if (!info?.id || !sessionId) return;
      // The active root session: fold its revert marker, so a revert done by
      // another client (or the server clearing one) stays in sync here. The
      // local droppedCount survives as long as the checkpoint didn't move.
      if (info.id === sessionId) {
        const revert = mapSessionRevert(info.revert);
        set((s) => ({
          revert: revert
            ? {
                ...revert,
                droppedCount:
                  s.revert?.messageID === revert.messageID ? s.revert.droppedCount : undefined,
              }
            : null,
        }));
        return;
      }
      // Only direct children of the active session become swarm cards;
      // unrelated sessions are ignored.
      if (info.parentID !== sessionId) return;
      registerChild(set, {
        id: info.id,
        agent: info.agent || "subagent",
        title: info.title || "",
        parentId: info.parentID,
        model: info.model?.modelID,
      });
      return;
    }
    case "message.updated": {
      const info = props.info as
        | { id?: string; role?: "user" | "assistant"; sessionID?: string }
        | undefined;
      if (!info?.id) return;
      const target = resolveTarget(get, info.sessionID);
      if (!target) return;
      if (info.role) roleById.set(info.id, info.role);
      if (info.role === "assistant") {
        upsertAssistant(set, info.id, metaFromInfo(info as Record<string, unknown>), target);
      } else if (info.role === "user" && target.kind === "root") {
        // The echo itself never enters the thread (the optimistic bubble already
        // renders it), but its server id must replace the bubble's `local-` id:
        // revert / edit / fork all need a real messageID to act on.
        adoptLocalUserId(set, info.id, target);
      }
      return;
    }
    case "message.removed": {
      const messageID = (props.messageID ?? props.id) as string | undefined;
      if (!messageID) return;
      const target = resolveTarget(get, props.sessionID as string | undefined);
      if (!target) return;
      set((s) => commit(s, target, readMessages(s, target).filter((m) => m.id !== messageID)));
      return;
    }
    case "message.part.updated": {
      const part = props.part as OcPart | undefined;
      if (!part?.messageID) return;
      const target = resolveTarget(get, part.sessionID);
      if (!target) return;
      if (roleById.get(part.messageID) === "user") return;
      upsertPart(set, part.messageID, mapPart(part), target);
      if (target.kind === "root") set({ status: "streaming" });
      return;
    }
    case "message.part.removed": {
      const messageID = props.messageID as string | undefined;
      const partID = props.partID as string | undefined;
      if (!messageID || !partID) return;
      const target = resolveTarget(get, props.sessionID as string | undefined);
      if (!target) return;
      set((s) => {
        const list = readMessages(s, target).slice();
        const idx = list.findIndex((m) => m.id === messageID);
        if (idx === -1) return {};
        list[idx] = { ...list[idx], parts: list[idx].parts.filter((p) => p.id !== partID) };
        return commit(s, target, list);
      });
      return;
    }
    case "message.part.delta": {
      const messageID = props.messageID as string | undefined;
      const partID = props.partID as string | undefined;
      const delta = props.delta as string | undefined;
      if (!messageID || !partID || delta == null) return;
      const target = resolveTarget(get, props.sessionID as string | undefined);
      if (!target) return;
      if (roleById.get(messageID) === "user") return;
      appendDelta(set, messageID, partID, delta, target);
      if (target.kind === "root") set({ status: "streaming" });
      return;
    }
    case "permission.asked": {
      const p = props as {
        id?: string;
        sessionID?: string;
        permission?: string;
        patterns?: string[];
      };
      if (!p.id || !resolveTarget(get, p.sessionID)) return;
      addPermission(set, {
        id: p.id,
        sessionID: p.sessionID as string,
        kind: "v1",
        action: p.permission ?? "action",
        targets: Array.isArray(p.patterns) ? p.patterns : [],
      });
      return;
    }
    case "permission.v2.asked": {
      const p = props as {
        id?: string;
        sessionID?: string;
        action?: string;
        resources?: string[];
      };
      if (!p.id || !resolveTarget(get, p.sessionID)) return;
      addPermission(set, {
        id: p.id,
        sessionID: p.sessionID as string,
        kind: "v2",
        action: p.action ?? "action",
        targets: Array.isArray(p.resources) ? p.resources : [],
      });
      return;
    }
    case "permission.replied":
    case "permission.v2.replied": {
      const requestID = (props.requestID ?? props.id) as string | undefined;
      if (!requestID) return;
      set((s) => ({
        pendingPermissions: s.pendingPermissions.filter((x) => x.id !== requestID),
      }));
      return;
    }
    case "question.asked":
    case "question.v2.asked": {
      const p = props as { id?: string; sessionID?: string; questions?: unknown };
      if (!p.id || !resolveTarget(get, p.sessionID)) return;
      const questions = Array.isArray(p.questions)
        ? (p.questions as QuestionInfo[]).filter((q) => q && typeof q.question === "string")
        : [];
      if (questions.length === 0) return;
      addQuestion(set, {
        id: p.id,
        sessionID: p.sessionID as string,
        kind: ev.type === "question.v2.asked" ? "v2" : "v1",
        questions: questions.map((q) => ({
          question: q.question,
          header: q.header,
          options: Array.isArray(q.options) ? q.options : [],
          multiple: q.multiple,
          custom: q.custom,
        })),
      });
      return;
    }
    case "question.replied":
    case "question.rejected":
    case "question.v2.replied":
    case "question.v2.rejected": {
      const requestID = (props.requestID ?? props.id) as string | undefined;
      if (!requestID) return;
      set((s) => ({
        pendingQuestions: s.pendingQuestions.filter((x) => x.id !== requestID),
      }));
      return;
    }
    case "todo.updated": {
      const sid = props.sessionID as string | undefined;
      if (!sid || !resolveTarget(get, sid)) return;
      const todos: TodoItem[] = Array.isArray(props.todos)
        ? (props.todos as TodoItem[]).filter((t) => t && typeof t.content === "string")
        : [];
      set((s) => ({ todosBySession: { ...s.todosBySession, [sid]: todos } }));
      return;
    }
    case "session.compacted": {
      const sid = props.sessionID as string | undefined;
      // Only the active root session's compaction repaints this thread.
      if (!sid || sid !== sessionId) return;
      get().onSessionCompacted();
      return;
    }
    case "file.edited": {
      // The event carries only `{ file }` (no sessionID, verified against the
      // 1.16 spec), so scope by activity: only a live turn of the active root
      // session (or its children) can be the author. The EventSource is
      // already directory-scoped, so the worst mis-attribution is another
      // turn of the SAME project, never another one.
      const file = props.file as string | undefined;
      if (!file || get().status === "idle") return;
      set((s) =>
        s.editedFiles.includes(file) ? {} : { editedFiles: [...s.editedFiles, file] },
      );
      return;
    }
    case "session.error": {
      const sid = props.sessionID as string | undefined;
      const message = flattenError(props.error) ?? "unknown error";
      const target = resolveTarget(get, sid);
      if (!target) return;
      if (target.kind === "root") {
        // `compacting` settles here too: a summarize that dies without ever
        // emitting `session.compacted` must not pin the compact button.
        set({ status: "idle", error: message, compacting: false });
      } else {
        set((s) => ({
          childSessions: s.childSessions.map((c) =>
            c.id === target.id ? { ...c, done: true, error: message } : c,
          ),
        }));
      }
      clearPromptsFor(set, sid);
      return;
    }
    case "session.idle": {
      const sid = props.sessionID as string | undefined;
      if (sid === sessionId) {
        set({ status: "idle", compacting: false });
      } else if (sid && get().childSessions.some((c) => c.id === sid)) {
        set((s) => ({
          childSessions: s.childSessions.map((c) => (c.id === sid ? { ...c, done: true } : c)),
        }));
      }
      // A session that went idle has nothing pending anymore; drop stale cards.
      clearPromptsFor(set, sid);
      // Post-turn effects (context-usage refresh, queued-prompt dispatch) run
      // ONLY for the active root session: a child or foreign session going
      // idle must never trigger them.
      if (sid === sessionId) get().onRootIdle();
      return;
    }
    default:
      return;
  }
}

/** Map a stored history row (`GET /session/{id}/message`) to a thread message. */
export function mapStoredMessage(row: unknown): ChatMessage | null {
  const r = row as { info?: { id?: string; role?: string }; parts?: OcPart[] };
  if (!r?.info?.id || (r.info.role !== "user" && r.info.role !== "assistant")) return null;
  const meta = r.info.role === "assistant" ? metaFromInfo(r.info as Record<string, unknown>) : {};
  return {
    id: r.info.id,
    role: r.info.role,
    parts: (r.parts ?? []).map(mapPart),
    ...meta,
  };
}

function mapPart(p: OcPart): ChatPart {
  return {
    id: p.id,
    type: partType(p.type),
    text: p.text,
    // File attachments echo back from stored history; keep enough to re-render
    // the chip (thumbnail for data: URLs, name otherwise).
    file:
      p.type === "file" ? { mime: p.mime, filename: p.filename, url: p.url } : undefined,
    // Reasoning carries its window on the part; a tool carries it on `state`.
    time: p.type === "reasoning" ? p.time : p.state?.time,
    tool:
      p.type === "tool"
        ? {
            name: p.tool,
            status: p.state?.status,
            input: p.state?.input,
            output: p.state?.output,
            title: p.state?.title,
          }
        : undefined,
  };
}

function addPermission(set: Set, prompt: PermissionPrompt) {
  set((s) =>
    s.pendingPermissions.some((p) => p.id === prompt.id)
      ? {}
      : { pendingPermissions: [...s.pendingPermissions, prompt] },
  );
}

function addQuestion(set: Set, prompt: QuestionPrompt) {
  set((s) =>
    s.pendingQuestions.some((p) => p.id === prompt.id)
      ? {}
      : { pendingQuestions: [...s.pendingQuestions, prompt] },
  );
}

/** Drop pending permission/question cards owned by a finished session. */
function clearPromptsFor(set: Set, sessionID: string | undefined) {
  if (!sessionID) return;
  set((s) => ({
    pendingPermissions: s.pendingPermissions.filter((p) => p.sessionID !== sessionID),
    pendingQuestions: s.pendingQuestions.filter((p) => p.sessionID !== sessionID),
  }));
}

/** Swap the optimistic `local-` user bubble's id for the server's echo id.
 *  At most one optimistic bubble exists (send is single-flight); we take the
 *  LAST one so a stale leftover can never steal a newer echo. No-op when the
 *  server id is already present (duplicate event). */
function adoptLocalUserId(set: Set, serverId: string, target: Target) {
  set((s) => {
    const list = readMessages(s, target);
    if (list.some((m) => m.id === serverId)) return {};
    let idx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === "user" && list[i].id.startsWith("local-")) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return {};
    const next = list.slice();
    next[idx] = { ...next[idx], id: serverId };
    return commit(s, target, next);
  });
}

/** Register/refresh a swarm child session (idempotent on id). */
function registerChild(set: Set, child: ChildSession) {
  set((s) => {
    const idx = s.childSessions.findIndex((c) => c.id === child.id);
    if (idx === -1) {
      return {
        childSessions: [...s.childSessions, child],
        childThreads: { ...s.childThreads, [child.id]: s.childThreads[child.id] ?? [] },
      };
    }
    // Keep a child that's already finished marked done; only refresh agent/title.
    const next = s.childSessions.slice();
    next[idx] = {
      ...next[idx],
      agent: child.agent,
      title: child.title || next[idx].title,
      model: child.model ?? next[idx].model,
    };
    return { childSessions: next };
  });
}

/**
 * Read the message list for a target (root thread or a child sub-thread) and
 * write the updated list back into the right slice. Lets the folders below
 * stay target-agnostic.
 */
function readMessages(s: ChatState, target: Target): ChatMessage[] {
  if (target?.kind === "child") return s.childThreads[target.id] ?? [];
  return s.thread;
}

function upsertAssistant(set: Set, id: string, meta: AssistantMeta, target: Target) {
  set((s) => {
    const list = readMessages(s, target);
    const idx = list.findIndex((m) => m.id === id);
    const next =
      idx === -1
        ? [...list, { id, role: "assistant" as const, parts: [], ...meta }]
        : list.map((m, i) => (i === idx ? { ...m, ...defined(meta) } : m));
    return commit(s, target, next);
  });
}

function upsertPart(set: Set, messageID: string, part: ChatPart, target: Target) {
  set((s) => {
    const list = readMessages(s, target).slice();
    let idx = list.findIndex((m) => m.id === messageID);
    if (idx === -1) {
      list.push({ id: messageID, role: "assistant", parts: [] });
      idx = list.length - 1;
    }
    const msg = list[idx];
    const pIdx = msg.parts.findIndex((p) => p.id === part.id);
    // `defined()` merge: a snapshot lacking a field must not clobber state the
    // part already accumulated (e.g. text built up from deltas).
    const parts =
      pIdx === -1
        ? [...msg.parts, part]
        : msg.parts.map((p, i) => (i === pIdx ? ({ ...p, ...defined(part) } as ChatPart) : p));
    list[idx] = { ...msg, parts };
    return commit(s, target, list);
  });
}

function appendDelta(set: Set, messageID: string, partID: string, delta: string, target: Target) {
  set((s) => {
    const list = readMessages(s, target).slice();
    let idx = list.findIndex((m) => m.id === messageID);
    if (idx === -1) {
      // Delta racing ahead of `message.updated`: fabricate the assistant
      // message instead of dropping streamed text on the floor.
      list.push({ id: messageID, role: "assistant", parts: [] });
      idx = list.length - 1;
    }
    const msg = list[idx];
    const pIdx = msg.parts.findIndex((p) => p.id === partID);
    // An unknown part defaults to "text"; the part.updated snapshot that
    // follows corrects the type via the `defined()` merge in upsertPart.
    const parts =
      pIdx === -1
        ? [...msg.parts, { id: partID, type: "text" as PartType, text: delta }]
        : msg.parts.map((p, i) => (i === pIdx ? { ...p, text: (p.text ?? "") + delta } : p));
    list[idx] = { ...msg, parts };
    return commit(s, target, list);
  });
}

/** Write a recomputed message list back into the root thread or a child slice. */
function commit(
  s: ChatState,
  target: Target,
  messages: ChatMessage[],
): Partial<ChatState> {
  if (target?.kind === "child") {
    return { childThreads: { ...s.childThreads, [target.id]: messages } };
  }
  return { thread: messages };
}
