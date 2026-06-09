import type {
  ChatMessage,
  ChatPart,
  ChatState,
  ChildSession,
  Get,
  PartType,
  Set,
} from "./chat.store";
import type { PermissionPrompt } from "./opencode";

/**
 * Event-folding layer for the agent chat. Pure reducers that turn the opencode
 * SSE stream (and stored-message history) into the renderable thread model. Kept
 * out of the store so the store stays about transport + state; everything here is
 * a `(get, set)`-driven mutation over the thread, with no I/O.
 */

// Maps an opencode messageID to its role so the reducer can drop the server's
// echo of the user's message (we render an optimistic local bubble instead).
const roleById = new Map<string, "user" | "assistant">();

/** Reset the role map — called when the thread is cleared (new chat / project). */
export function clearRoles() {
  roleById.clear();
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
  time?: { start?: number; end?: number };
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    title?: string;
    time?: { start?: number; end?: number };
  };
}

/**
 * Resolve which thread an event for `evSessionID` belongs to: the active root
 * session, a known swarm child session, or neither (drop). Child events used to
 * be dropped wholesale — that's why delegation was invisible before swarm mode
 * grew real rendering.
 */
type Target = { kind: "root" } | { kind: "child"; id: string } | null;
function resolveTarget(get: Get, evSessionID: string | undefined): Target {
  const root = get().sessionId;
  if (!root || !evSessionID) return null;
  if (evSessionID === root) return { kind: "root" };
  if (get().childSessions.some((c) => c.id === evSessionID)) return { kind: "child", id: evSessionID };
  return null;
}

/** Fold one opencode event into the thread / pending-permission state. */
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
          }
        | undefined;
      // Only direct children of the active session become swarm cards; the root
      // session itself and unrelated sessions are ignored here.
      if (!info?.id || !sessionId || info.parentID !== sessionId) return;
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
        | { id?: string; role?: "user" | "assistant"; sessionID?: string; finish?: string }
        | undefined;
      if (!info?.id) return;
      const target = resolveTarget(get, info.sessionID);
      if (!target) return;
      if (info.role) roleById.set(info.id, info.role);
      if (info.role === "assistant") {
        upsertAssistant(set, info.id, info.finish ?? null, target);
      }
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
      if (!p.id || p.sessionID !== sessionId) return;
      addPermission(set, {
        id: p.id,
        sessionID: p.sessionID,
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
      if (!p.id || p.sessionID !== sessionId) return;
      addPermission(set, {
        id: p.id,
        sessionID: p.sessionID,
        kind: "v2",
        action: p.action ?? "action",
        targets: Array.isArray(p.resources) ? p.resources : [],
      });
      return;
    }
    case "permission.replied":
    case "permission.v2.replied": {
      const requestID = props.requestID as string | undefined;
      if (!requestID) return;
      set((s) => ({
        pendingPermissions: s.pendingPermissions.filter((x) => x.id !== requestID),
      }));
      return;
    }
    case "session.idle": {
      const sid = props.sessionID as string | undefined;
      if (sid === sessionId) {
        set({ status: "idle" });
      } else if (sid && get().childSessions.some((c) => c.id === sid)) {
        set((s) => ({
          childSessions: s.childSessions.map((c) => (c.id === sid ? { ...c, done: true } : c)),
        }));
      }
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
  return {
    id: r.info.id,
    role: r.info.role,
    parts: (r.parts ?? []).map(mapPart),
  };
}

function mapPart(p: OcPart): ChatPart {
  return {
    id: p.id,
    type: (p.type as PartType) ?? "text",
    text: p.text,
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
 * write the updated list back into the right slice. Lets the three folders below
 * stay target-agnostic.
 */
function readMessages(s: ChatState, target: Target): ChatMessage[] {
  if (target?.kind === "child") return s.childThreads[target.id] ?? [];
  return s.thread;
}

function upsertAssistant(set: Set, id: string, finish: string | null, target: Target) {
  set((s) => {
    const list = readMessages(s, target);
    const idx = list.findIndex((m) => m.id === id);
    const next =
      idx === -1
        ? [...list, { id, role: "assistant" as const, parts: [], finish }]
        : list.map((m, i) => (i === idx ? { ...m, finish } : m));
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
    const parts =
      pIdx === -1
        ? [...msg.parts, part]
        : msg.parts.map((p, i) => (i === pIdx ? { ...p, ...part } : p));
    list[idx] = { ...msg, parts };
    return commit(s, target, list);
  });
}

function appendDelta(set: Set, messageID: string, partID: string, delta: string, target: Target) {
  set((s) => {
    const list = readMessages(s, target);
    const idx = list.findIndex((m) => m.id === messageID);
    if (idx === -1) return {};
    const next = list.slice();
    const msg = next[idx];
    const pIdx = msg.parts.findIndex((p) => p.id === partID);
    const parts =
      pIdx === -1
        ? [...msg.parts, { id: partID, type: "text" as PartType, text: delta }]
        : msg.parts.map((p, i) => (i === pIdx ? { ...p, text: (p.text ?? "") + delta } : p));
    next[idx] = { ...msg, parts };
    return commit(s, target, next);
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
