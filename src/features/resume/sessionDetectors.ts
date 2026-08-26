/**
 * Regex-based detectors that watch CLI scrollback for session-id prints.
 *
 * Status quo of each CLI's emission (as of writing):
 *  - **Claude Code** prints `Session ID: <uuid-4>` once at startup and on
 *    `/session` info. Other formats observed: `(session abc123…)`.
 *  - **Codex CLI** prints `Session-Token: <hex>` or `Session: <uuid>` —
 *    formats moved around between releases. Prefer UUID, then hex; do not
 *    accept arbitrary 20+ char tokens (paths and thread titles look like
 *    session ids under a greedy matcher).
 *  - **Aider** does NOT emit a session id — it stores chat history per file.
 *    For now we skip resume capture for Aider entirely (tile won't show).
 *  - **OpenCode / Gemini / Grok / Pi / Goose / Antigravity** — TODO research.
 *    The generic UUID-after-"session" detector below catches many of them
 *    incidentally.
 *
 * Each detector returns the FIRST session id it finds — duplicate captures
 * are deduped in `resume_save` (key = cli_id + session_id + cwd).
 */
export interface SessionDetectorResult {
  sessionId: string;
}

export type SessionDetector = (scrollbackTail: string) => SessionDetectorResult | null;

const UUID_V4 = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const HEX_TOKEN = /([0-9a-f]{12,64})/i;

function makeGenericDetector(label: RegExp, value: RegExp): SessionDetector {
  return (tail) => {
    // Walk lines bottom-up — most recent first — so a stale id from a previous
    // run earlier in the scrollback doesn't shadow a new one.
    const lines = tail.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!label.test(line)) continue;
      const m = line.match(value);
      if (m && m[1]) return { sessionId: m[1] };
    }
    return null;
  };
}

const detectCodexUuid = makeGenericDetector(/session[\s\-_:]/i, UUID_V4);
const detectCodexHex = makeGenericDetector(/session[\s\-_:]/i, HEX_TOKEN);

function detectCodexSession(tail: string): SessionDetectorResult | null {
  return detectCodexUuid(tail) ?? detectCodexHex(tail);
}

const DETECTORS: Record<string, SessionDetector> = {
  "claude-code": makeGenericDetector(/session[\s\-_:]/i, UUID_V4),
  "codex-cli": detectCodexSession,
  opencode: makeGenericDetector(/session[\s\-_:]/i, UUID_V4),
  "gemini-cli": makeGenericDetector(/session[\s\-_:]/i, UUID_V4),
  grok: makeGenericDetector(/session[\s\-_:]/i, UUID_V4),
  goose: makeGenericDetector(/session[\s\-_:]/i, HEX_TOKEN),
  antigravity: makeGenericDetector(/session[\s\-_:]/i, UUID_V4),
};

/**
 * Look up the detector for a given CLI id. Returns null when we don't have one
 * registered (Aider, unknown ids, etc.) so callers can skip capture entirely.
 */
export function detectorFor(cliId: string | undefined): SessionDetector | null {
  if (!cliId) return null;
  return DETECTORS[cliId] ?? null;
}

/**
 * How to re-open a captured session. Some CLIs take a flag (`claude --resume ID`),
 * others a subcommand (`codex resume ID`). Missing entries hide the resume
 * affordance for that tool.
 */
export type ResumeStyle =
  | { kind: "flag"; token: string }
  | { kind: "subcommand"; token: string };

export const RESUME_STYLES: Record<string, ResumeStyle> = {
  "claude-code": { kind: "flag", token: "--resume" },
  "codex-cli": { kind: "subcommand", token: "resume" },
  opencode: { kind: "flag", token: "--session" },
  "gemini-cli": { kind: "flag", token: "--resume" },
};

export function supportsResume(cliId: string): boolean {
  return Object.hasOwn(RESUME_STYLES, cliId);
}

/** Extra argv after the CLI's own `args`, or null when resume is unsupported. */
export function resumeArgsFor(cliId: string, sessionId: string): string[] | null {
  const style = RESUME_STYLES[cliId];
  if (!style) return null;
  return [style.token, sessionId];
}
