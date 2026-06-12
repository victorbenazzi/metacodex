export type CliDangerLevel = "normal" | "dangerous";

/**
 * Grouping in the launcher menu:
 * - "coding"     → flat list under the "Coding Agents" header (Claude Code, Codex, …)
 * - "autonomous" → nested under a collapsible "Autonomous Agents" header (Hermes, OpenClaw)
 *
 * Missing/undefined defaults to "coding" so older entries stay where they are.
 */
export type CliCategory = "coding" | "autonomous";

export interface CliTool {
  id: string;
  label: string;
  /** Bare program name expected on PATH. */
  command: string;
  /** Args appended to `command` when launching. */
  args: string[];
  /** Shell snippet used to detect installation (unix: `command -v <cmd>`). */
  detectCommand: string;
  /** Primary install command shown to the user when missing. */
  installCommand: string;
  /** Optional alternative install command (e.g. npm fallback). */
  altInstallCommand?: string;
  docsUrl?: string;
  description: string;
  dangerLevel?: CliDangerLevel;
  /** Marks CLIs whose install/launch command is not officially confirmed yet. */
  needsConfig?: boolean;
  category?: CliCategory;
}

/**
 * Default registry shipped with metacodex.
 * Users can override entries via `cliRegistryOverrides` in the persisted store.
 */
export const DEFAULT_CLI_REGISTRY: CliTool[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    command: "claude",
    args: ["--dangerously-skip-permissions"],
    detectCommand: "command -v claude",
    installCommand: "curl -fsSL https://claude.ai/install.sh | bash",
    altInstallCommand: "npm install -g @anthropic-ai/claude-code",
    docsUrl: "https://docs.claude.com/en/docs/claude-code",
    description: "Anthropic's terminal-native coding agent.",
    dangerLevel: "dangerous",
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    command: "codex",
    args: [],
    detectCommand: "command -v codex",
    installCommand: "npm install -g @openai/codex",
    docsUrl: "https://github.com/openai/codex",
    description: "OpenAI's terminal coding agent.",
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    args: [],
    detectCommand: "command -v opencode",
    installCommand: "curl -fsSL https://opencode.ai/install | bash",
    docsUrl: "https://opencode.ai",
    description: "Open-source AI coding agent.",
  },
  {
    id: "mimo-code",
    label: "MiMo Code",
    command: "mimo",
    args: [],
    detectCommand: "command -v mimo",
    installCommand: "curl -fsSL https://mimo.xiaomi.com/install | bash",
    altInstallCommand: "npm install -g @mimo-ai/cli",
    docsUrl: "https://mimo.xiaomi.com/mimocode",
    description: "Xiaomi's terminal coding agent.",
  },
  {
    id: "antigravity-cli",
    label: "Antigravity CLI",
    command: "antigravity",
    args: [],
    detectCommand: "command -v antigravity",
    installCommand: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    docsUrl: "https://antigravity.google",
    description: "Google's Antigravity agent shell.",
  },
  {
    id: "pi-cli",
    label: "Pi CLI",
    command: "pi",
    args: [],
    detectCommand: "command -v pi",
    installCommand: "",
    description:
      "Inflection Pi terminal client. Official install command not yet confirmed, configure in CLI registry.",
    needsConfig: true,
  },
  {
    id: "hermes",
    label: "Hermes",
    command: "hermes",
    args: [],
    detectCommand: "command -v hermes",
    installCommand:
      "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
    docsUrl: "https://github.com/NousResearch/hermes-agent",
    description: "NousResearch's autonomous research agent.",
    category: "autonomous",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    command: "openclaw",
    args: [],
    detectCommand: "command -v openclaw",
    installCommand: "npm i -g openclaw",
    altInstallCommand: "curl -fsSL https://openclaw.ai/install.sh | bash",
    docsUrl: "https://openclaw.ai",
    description: "Open-source autonomous agent reachable via chat apps.",
    category: "autonomous",
  },
];

export function cliById(id: string, registry: CliTool[] = DEFAULT_CLI_REGISTRY): CliTool | undefined {
  return registry.find((c) => c.id === id);
}

/** Combine `command` + args into a single shell command string. */
export function cliLaunchString(cli: CliTool): string {
  if (!cli.args.length) return cli.command;
  return [cli.command, ...cli.args].join(" ");
}

/** Default category for a CLI ("coding" when omitted). */
export function cliCategory(cli: CliTool): CliCategory {
  return cli.category ?? "coding";
}

/**
 * Returns true when the agent should be visible in the launcher menu.
 * Defaults to `true` for any cli id missing from the map — new agents added to
 * the registry are visible by default; users opt them out via Settings → Interface.
 */
export function isAgentEnabled(cliId: string, enabledAgents: Record<string, boolean>): boolean {
  return enabledAgents[cliId] ?? true;
}
