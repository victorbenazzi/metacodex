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
 * `task` tool reliably needs a stronger model than the chat default — a flash
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
  /** opencode permission/request id — the path segment we reply on. */
  id: string;
  sessionID: string;
  /** v1 (session-scoped) vs v2 (server-scoped) reply endpoint. */
  kind: "v1" | "v2";
  /** Human label: the tool/action the agent wants to run (e.g. "edit", "bash"). */
  action: string;
  /** Concrete targets — file globs (v1 patterns) or resources (v2). */
  targets: string[];
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
 * regardless of the active agent's defaults — in swarm mode the whole point is
 * for the orchestrator to spawn subagents freely.
 */
export function rulesetForPreset(preset: PermissionPreset, swarm = false): PermissionRule[] {
  const swarmRule: PermissionRule[] = swarm
    ? [{ permission: "task", pattern: ANY_PATH, action: "allow" }]
    : [];
  switch (preset) {
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
 * (rendered nested in the thread) appear. Worded as a directive, not a hint —
 * a softer nudge leaves weaker models doing everything in one thread.
 */
export const SWARM_SYSTEM =
  "You are the orchestrator in swarm mode. Before doing any substantial work yourself, " +
  "decompose the request into independent subtasks and delegate each one to a subagent " +
  "with the `task` tool — run them in parallel whenever the subtasks don't depend on each " +
  "other. Use the `task` tool generously: prefer spawning a subagent over doing research, " +
  "exploration, or a self-contained change inline. Reserve your own turns for planning the " +
  "split and synthesizing the subagents' results into a final answer. Only skip delegation " +
  "for requests too small to split.";

/** Pick the primary agent to run: prefer "build", else the first primary. */
export function primaryAgentName(agents: AgentInfo[]): string | undefined {
  const primaries = agents.filter((a) => a.mode === "primary" || a.mode === "all");
  const build = primaries.find((a) => a.name === "build");
  return (build ?? primaries[0])?.name;
}
