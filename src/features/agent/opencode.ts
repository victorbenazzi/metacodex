import type { ChatMessage } from "./chat.store";

/**
 * Shared opencode harness vocabulary for the Agent View. The webview drives the
 * `opencode serve` sidecar directly; this module holds the small, pure pieces
 * the chat store and composer agree on: permission presets → an opencode
 * `PermissionRuleset`, the agent-mode → system-prompt mapping, and the live
 * permission-request shape. No I/O here, just data + mappers.
 */

/** The three permission postures the composer exposes (persisted in settings). */
export const PERMISSION_PRESETS = ["ask", "auto-edit", "full-auto"] as const;
export type PermissionPreset = (typeof PERMISSION_PRESETS)[number];

/** Single primary agent vs an orchestrator that delegates to subagents. */
export const AGENT_MODES = ["agent", "swarm"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/**
 * Model the orchestrator runs on in swarm mode. Decomposing work and driving the
 * `task` tool reliably needs a stronger model than the chat default, a flash
 * model rarely delegates on its own. Only swapped in when the active provider is
 * opencode-go (where this id exists); other providers keep the user's choice.
 * One-line knob: bump this to any opencode-go model from `opencode models`.
 */
export const SWARM_PROVIDER = "opencode-go";
export const SWARM_ORCHESTRATOR_MODEL_ID = "kimi-k2.6";

/** One rule in an opencode `PermissionRuleset`. */
export interface PermissionRule {
  permission: string;
  pattern: string;
  action: "allow" | "deny" | "ask";
}

/** A live permission request surfaced from the opencode event stream. */
export interface PermissionPrompt {
  /** opencode permission/request id: the path segment we reply on. */
  id: string;
  sessionID: string;
  /** v1 (session-scoped) vs v2 (server-scoped) reply endpoint. */
  kind: "v1" | "v2";
  /** Human label: the tool/action the agent wants to run (e.g. "edit", "bash"). */
  action: string;
  /** Concrete targets: file globs (v1 patterns) or resources (v2). */
  targets: string[];
}

/** One selectable choice inside an agent question. */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** One question the agent asks the user (opencode `QuestionInfo`). */
export interface QuestionInfo {
  question: string;
  /** Very short chip label (max ~30 chars). */
  header?: string;
  options: QuestionOption[];
  /** Multiple selections allowed. */
  multiple?: boolean;
  /** Free-text answers allowed. */
  custom?: boolean;
}

/** A live question request (`question.asked` / `question.v2.asked`): the agent
 *  is blocked until the user answers or rejects. Answers are arrays of selected
 *  labels, one array per question, in order. */
export interface QuestionPrompt {
  id: string;
  sessionID: string;
  kind: "v1" | "v2";
  questions: QuestionInfo[];
}

/** One agent plan item (`todo.updated` / `GET /session/{id}/todo`). */
export interface TodoItem {
  content: string;
  /** pending | in_progress | completed | cancelled */
  status: string;
  priority?: string;
}

export interface AgentInfo {
  name: string;
  mode: "subagent" | "primary" | "all";
}

/** opencode reply verbs for a permission request. */
export type PermissionReply = "once" | "always" | "reject";

// Path-glob permissions answer to "**"; bash matches the command string with "*".
const ANY_PATH = "**";
const ANY_CMD = "*";

/**
 * Map a preset to an opencode `PermissionRuleset`. Read-only tools (read, glob,
 * grep, list, lsp) are left unset so they keep opencode's permissive default;
 * we only pin the consequential ones (edit, bash, network, escaping the root).
 *
 * `swarm` pins `task: allow` so delegation never stalls on a permission prompt
 * regardless of the active agent's defaults: in swarm mode the whole point is
 * for the orchestrator to spawn subagents freely.
 *
 * MANUAL MIRROR: the `full-auto` branch is duplicated in Rust as
 * `runtime.rs::full_auto_ruleset` (headless scheduled runs). If you change it
 * here, change it there; a Rust test pins that side's JSON.
 */
export function rulesetForPreset(preset: PermissionPreset, swarm = false): PermissionRule[] {
  const swarmRule: PermissionRule[] = swarm
    ? [{ permission: "task", pattern: ANY_PATH, action: "allow" }]
    : [];
  switch (preset) {
    default: // fail CLOSED: an out-of-union value (stale persisted settings) must never widen permissions
    case "ask":
      return [
        { permission: "edit", pattern: ANY_PATH, action: "ask" },
        { permission: "bash", pattern: ANY_CMD, action: "ask" },
        { permission: "webfetch", pattern: ANY_PATH, action: "ask" },
        { permission: "websearch", pattern: ANY_PATH, action: "ask" },
        { permission: "external_directory", pattern: ANY_PATH, action: "ask" },
        ...swarmRule,
      ];
    case "auto-edit":
      return [
        { permission: "edit", pattern: ANY_PATH, action: "allow" },
        { permission: "bash", pattern: ANY_CMD, action: "ask" },
        { permission: "webfetch", pattern: ANY_PATH, action: "allow" },
        { permission: "websearch", pattern: ANY_PATH, action: "allow" },
        { permission: "external_directory", pattern: ANY_PATH, action: "ask" },
        ...swarmRule,
      ];
    case "full-auto":
      return [
        { permission: "edit", pattern: ANY_PATH, action: "allow" },
        { permission: "bash", pattern: ANY_CMD, action: "allow" },
        { permission: "webfetch", pattern: ANY_PATH, action: "allow" },
        { permission: "websearch", pattern: ANY_PATH, action: "allow" },
        { permission: "external_directory", pattern: ANY_PATH, action: "allow" },
        { permission: "task", pattern: ANY_PATH, action: "allow" },
      ];
  }
}

/**
 * Extra system instruction for swarm mode. Single mode sends nothing and lets
 * the primary agent behave normally; swarm pushes it to decompose and delegate
 * to subagents via the `task` tool, which is what makes the child sessions
 * (rendered nested in the thread) appear. Worded as a directive, not a hint , 
 * a softer nudge leaves weaker models doing everything in one thread.
 */
export const SWARM_SYSTEM =
  "You are the orchestrator in swarm mode. Before doing any substantial work yourself, " +
  "decompose the request into independent subtasks and delegate each one to a subagent " +
  "with the `task` tool, run them in parallel whenever the subtasks don't depend on each " +
  "other. Use the `task` tool generously: prefer spawning a subagent over doing research, " +
  "exploration, or a self-contained change inline. Reserve your own turns for planning the " +
  "split and synthesizing the subagents' results into a final answer. Only skip delegation " +
  "for requests too small to split.";

/** Active revert marker on a session: the checkpoint the conversation (and the
 *  files on disk) were rolled back to. */
export interface SessionRevert {
  messageID: string;
  partID?: string;
}

/** Map a Session's `revert` field (`{ messageID, partID?, snapshot?, diff? }`).
 *  The single place that knows that shape. */
export function mapSessionRevert(raw: unknown): SessionRevert | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { messageID?: unknown; partID?: unknown };
  if (typeof r.messageID !== "string" || !r.messageID) return null;
  return {
    messageID: r.messageID,
    ...(typeof r.partID === "string" ? { partID: r.partID } : {}),
  };
}

/**
 * Hide messages undone by an active revert. opencode's revert is inclusive
 * ("undoing its effects"): the target message and everything after it are
 * rolled back, so the cut starts AT the target. No-op when the transcript
 * already arrives filtered (target not found).
 */
export function applyRevertCut<T extends { id: string }>(
  messages: T[],
  revert: SessionRevert | null | undefined,
): T[] {
  if (!revert) return messages;
  const idx = messages.findIndex((m) => m.id === revert.messageID);
  return idx === -1 ? messages : messages.slice(0, idx);
}

/** One file entry of a session diff (opencode `SnapshotFileDiff`). */
export interface SessionFileDiff {
  file: string;
  additions: number;
  deletions: number;
  /** Unified patch text, ready for `diff` highlighting (absent for binaries). */
  patch?: string;
  /** added | deleted | modified */
  status?: string;
}

/**
 * Files touched by edit/write tool calls across a transcript, deduped in
 * first-seen order. Drives the "N files changed" chip rehydration and the
 * revert confirm summary (live turns also accumulate via `file.edited`).
 */
export function editedFilesFromMessages(messages: ChatMessage[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type !== "tool" || !p.tool) continue;
      const name = p.tool.name;
      if (name !== "edit" && name !== "write" && name !== "patch") continue;
      const input = (p.tool.input ?? {}) as Record<string, unknown>;
      const file = typeof input.filePath === "string" ? input.filePath : undefined;
      if (!file || seen.has(file)) continue;
      seen.add(file);
      out.push(file);
    }
  }
  return out;
}

/** Pick the primary agent to run: prefer "build", else the first primary. */
export function primaryAgentName(agents: AgentInfo[]): string | undefined {
  const primaries = agents.filter((a) => a.mode === "primary" || a.mode === "all");
  const build = primaries.find((a) => a.name === "build");
  return (build ?? primaries[0])?.name;
}

/** The model a send actually runs on: swarm swaps in the orchestrator model
 *  when the provider carries it. Single source for the send path AND the
 *  composer controls (VariantPicker), so the displayed effort always matches
 *  the model that receives it. */
export function effectiveModelId(providerID: string, modelID: string, mode: AgentMode): string {
  return mode === "swarm" && providerID === SWARM_PROVIDER ? SWARM_ORCHESTRATOR_MODEL_ID : modelID;
}
