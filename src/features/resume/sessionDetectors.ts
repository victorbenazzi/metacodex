/**
 * Regex-based detectors that watch CLI scrollback for session-id prints.
 *
 * Status quo of each CLI's emission (as of writing):
 *  - **Claude Code** prints `Session ID: <uuid-4>` once at startup and on
 *    `/session` info. Other formats observed: `(session abc123…)`.
 *  - **Codex CLI** prints `Session-Token: <hex>` or `Session: <uuid>` —
 *    formats moved around between releases, so we accept several variants.
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

const DETECTORS: Record<string, SessionDetector> = {
  "claude-code": makeGenericDetector(/session[\s\-_:]/i, UUID_V4),
  "codex-cli": makeGenericDetector(/session[\s\-_:]/i, /([A-Za-z0-9_-]{20,})/),
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
 * Map metacodex's cli-registry ids to the actual CLI flag that resumes a session.
 * Used by `resumeLaunch` to build the spawn command. When a CLI doesn't have a
 * documented flag the entry stays absent and the resume button is hidden for it.
 */
export const RESUME_FLAGS: Record<string, string> = {
  "claude-code": "--resume",
  "codex-cli": "--resume",
  opencode: "--resume",
  "gemini-cli": "--resume",
};

export function resumeFlagFor(cliId: string): string | null {
  return RESUME_FLAGS[cliId] ?? null;
}
