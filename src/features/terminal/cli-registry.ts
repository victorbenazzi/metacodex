export type CliDangerLevel = "normal" | "dangerous";

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
];

export function cliById(id: string, registry: CliTool[] = DEFAULT_CLI_REGISTRY): CliTool | undefined {
  return registry.find((c) => c.id === id);
}

/** Combine `command` + args into a single shell command string. */
export function cliLaunchString(cli: CliTool): string {
  if (!cli.args.length) return cli.command;
  return [cli.command, ...cli.args].join(" ");
}
