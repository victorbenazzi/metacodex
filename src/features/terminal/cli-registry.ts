import { isWindows } from "@/lib/platform";

export type CliDangerLevel = "normal" | "dangerous";

/** Launcher grouping. Missing values default to the coding-agent section. */
export type CliCategory = "coding" | "autonomous";

export interface CliTool {
  id: string;
  label: string;
  /** Bare program name expected on PATH. */
  command: string;
  /** Args appended to `command` when launching. */
  args: string[];
  /** Arguments that bypass normal approval and require per-launch consent. */
  elevatedArgs?: string[];
  /**
   * Shell snippet shown to the user to verify installation. Defaults to the
   * Unix form (`command -v <cmd>`); use `cliDetectCommandDisplay` to read the
   * right one for the current platform.
   */
  detectCommand: string;
  /** Optional Windows-specific detect snippet (PowerShell `Get-Command`). */
  detectCommandWindows?: string;
  /** Primary install command shown to the user when missing (unix flavor). */
  installCommand: string;
  /** Optional Windows-specific primary install command. */
  installCommandWindows?: string;
  /** Optional alternative install command (e.g. npm fallback) — unix flavor. */
  altInstallCommand?: string;
  /** Optional Windows-specific alternative install command. */
  altInstallCommandWindows?: string;
  docsUrl?: string;
  description: string;
  dangerLevel?: CliDangerLevel;
  /** Marks CLIs whose install/launch command is not officially confirmed yet. */
  needsConfig?: boolean;
  category?: CliCategory;
  /** Whether PowerShell needs its stop-parsing token before launch arguments. */
  powerShellStopParsing?: boolean;
}

/**
 * Default registry shipped with metacodex.
 * Users can override entries via `cliRegistryOverrides` in the persisted store.
 *
 * `installCommand` keeps the macOS/Linux form (curl|bash, npm) for back-compat
 * with already-persisted overrides; `installCommandWindows` carries the winget
 * / scoop / npm form. Read via `cliInstallCommand(cli)`.
 */
export const DEFAULT_CLI_REGISTRY: CliTool[] = [
  {
    id: "mcx",
    label: "mcx",
    command: "mcx",
    args: [],
    detectCommand: "command -v mcx",
    detectCommandWindows: "Get-Command mcx",
    installCommand: "pnpm build && pnpm link --global",
    description:
      "metacodex multi-provider coding agent. Build from the metacodex-cli repo, then link it on PATH.",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    command: "claude",
    args: [],
    elevatedArgs: ["--dangerously-skip-permissions"],
    detectCommand: "command -v claude",
    detectCommandWindows: "Get-Command claude",
    installCommand: "curl -fsSL https://claude.ai/install.sh | bash",
    installCommandWindows: "npm install -g @anthropic-ai/claude-code",
    altInstallCommand: "npm install -g @anthropic-ai/claude-code",
    docsUrl: "https://docs.claude.com/en/docs/claude-code",
    description: "Anthropic's terminal-native coding agent.",
    dangerLevel: "dangerous",
    powerShellStopParsing: true,
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    command: "codex",
    args: [],
    detectCommand: "command -v codex",
    detectCommandWindows: "Get-Command codex",
    installCommand: "npm install -g @openai/codex",
    installCommandWindows: "npm install -g @openai/codex",
    docsUrl: "https://github.com/openai/codex",
    description: "OpenAI's terminal coding agent.",
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    args: [],
    detectCommand: "command -v opencode",
    detectCommandWindows: "Get-Command opencode",
    installCommand: "curl -fsSL https://opencode.ai/install | bash",
    installCommandWindows: "npm install -g opencode-ai",
    docsUrl: "https://opencode.ai",
    description: "Open-source AI coding agent.",
  },
  {
    id: "grok",
    label: "Grok Build",
    command: "grok",
    args: [],
    elevatedArgs: ["--always-approve"],
    detectCommand: "command -v grok",
    detectCommandWindows: "Get-Command grok",
    installCommand: "curl -fsSL https://x.ai/cli/install.sh | bash",
    docsUrl: "https://docs.x.ai/build",
    description: "xAI's terminal-native coding agent.",
    dangerLevel: "dangerous",
  },
  {
    id: "kimi-code",
    label: "Kimi Code",
    command: "kimi",
    args: [],
    elevatedArgs: ["--yolo"],
    detectCommand: "command -v kimi",
    detectCommandWindows: "Get-Command kimi",
    installCommand: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
    installCommandWindows: "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
    docsUrl: "https://code.kimi.com",
    description: "Moonshot's terminal-native coding agent.",
    dangerLevel: "dangerous",
    powerShellStopParsing: true,
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
    detectCommandWindows: "Get-Command antigravity",
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
    detectCommandWindows: "Get-Command pi",
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
export function cliLaunchString(
  cli: CliTool,
  options: { executable?: string; elevated?: boolean } = {},
): string {
  const executable = options.executable ?? cli.command;
  const args = options.elevated ? [...cli.args, ...(cli.elevatedArgs ?? [])] : cli.args;
  if (!args.length) return shellEscapeToken(executable);
  if (isWindows && cli.powerShellStopParsing) {
    // PowerShell parses `--flag` as a parameter unless we lead with the
    // stop-parsing token. Prepending `--%` makes pwsh forward every
    // subsequent token verbatim — required for `claude
    // --dangerously-skip-permissions`, which would otherwise be flagged
    // as an unknown parameter for the `claude` cmdlet alias.
    return [shellEscapeToken(executable), "--%", ...args.map(shellEscapeToken)].join(" ");
  }
  return [shellEscapeToken(executable), ...args.map(shellEscapeToken)].join(" ");
}

const KNOWN_ELEVATED_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--always-approve",
  "--yolo",
]);

export function normalizeCliTool(cli: CliTool): CliTool {
  const elevatedArgs = [...(cli.elevatedArgs ?? [])];
  const args = cli.args.filter((arg) => {
    if (!KNOWN_ELEVATED_FLAGS.has(arg)) return true;
    if (!elevatedArgs.includes(arg)) elevatedArgs.push(arg);
    return false;
  });
  return { ...cli, args, elevatedArgs };
}

function shellEscapeToken(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Default category for a CLI. */
export function cliCategory(cli: CliTool): CliCategory {
  return cli.category ?? "coding";
}

/**
 * Read the install command for the current platform. Falls back to the unix
 * `installCommand` field when no Windows-specific form is registered — users
 * with custom overrides keep working without rewriting their JSON.
 */
export function cliInstallCommand(cli: CliTool): string {
  if (isWindows && cli.installCommandWindows) return cli.installCommandWindows;
  return cli.installCommand;
}

export function cliAltInstallCommand(cli: CliTool): string | undefined {
  if (isWindows && cli.altInstallCommandWindows) return cli.altInstallCommandWindows;
  return cli.altInstallCommand;
}

export function cliDetectCommandDisplay(cli: CliTool): string {
  if (isWindows && cli.detectCommandWindows) return cli.detectCommandWindows;
  return cli.detectCommand;
}

/**
 * Returns true when the agent should be visible in the launcher menu.
 * Defaults to `true` for any cli id missing from the map — new agents added to
 * the registry are visible by default; users opt them out via Settings → Interface.
 */
export function isAgentEnabled(cliId: string, enabledAgents: Record<string, boolean>): boolean {
  return enabledAgents[cliId] ?? true;
}

/** Canonical enabled CLI list, in registry order, shared by every launcher surface. */
export function enabledCliTools(enabledAgents: Record<string, boolean>): CliTool[] {
  return DEFAULT_CLI_REGISTRY.filter((cli) => isAgentEnabled(cli.id, enabledAgents));
}

/** Enabled agents split by category in registry order. */
export function enabledAgentsByCategory(enabledAgents: Record<string, boolean>): {
  coding: CliTool[];
  autonomous: CliTool[];
} {
  const visible = enabledCliTools(enabledAgents);
  return {
    coding: visible.filter((cli) => cliCategory(cli) === "coding"),
    autonomous: visible.filter((cli) => cliCategory(cli) === "autonomous"),
  };
}
