/**
 * Quiet-window policy for agent status. CLI vs shell is decided by whether
 * the tab has a `cliId`, not by a field on this object.
 *
 * A new agent in the registry inherits the CLI default. Per-agent overlays
 * wait until a TUI actually breaks that default.
 */
export type AttentionProfile = {
  quietAfterMs: number;
  /** Vicinity text that means the TUI is still busy (spinner, Thinking). */
  workingPatterns: RegExp[];
  /** Vicinity text that means blocked on the user (y/n, approve). */
  attentionPatterns: RegExp[];
};

/** Permission / confirm copy. Shell's only path to attention; CLI safety net. */
export const ATTENTION_PATTERNS: RegExp[] = [
  /Do you want to[\s\S]{0,80}?\[y\/n\]/i,
  /Continue\?\s*\(y\/n\)/i,
  /Press\s+(?:Enter|RETURN)[\s\S]{0,40}?to\s+(?:continue|approve)/i,
  /Approve this (?:action|command|edit)\?/i,
  /(?:Allow|Apply|Run) this (?:edit|change|command)\?/i,
  /\?\s*Continue/i,
  /❯\s*Yes,?[\s\S]{0,8}?\bNo\b/,
  /Tool use \(.*\) requires approval/i,
];

const WORKING_PATTERNS: RegExp[] = [
  /\b(?:thinking|running|generating|searching|compiling)\b/i,
  /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,
  /[◐◓◑◒✦✶]/,
];

export const DEFAULT_CLI_PROFILE: AttentionProfile = {
  quietAfterMs: 2000,
  workingPatterns: WORKING_PATTERNS,
  attentionPatterns: ATTENTION_PATTERNS,
};

export const DEFAULT_SHELL_PROFILE: AttentionProfile = {
  quietAfterMs: 800,
  workingPatterns: [],
  attentionPatterns: ATTENTION_PATTERNS,
};

/** Shell when `cliId` is missing; CLI default otherwise. */
export function resolveAttentionProfile(cliId?: string): AttentionProfile {
  return cliId ? DEFAULT_CLI_PROFILE : DEFAULT_SHELL_PROFILE;
}

export function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[0]) return m[0].slice(0, 80);
  }
  return null;
}
