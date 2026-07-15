import type { IDisposable, Terminal } from "@xterm/xterm";

import type { AgentStatus } from "@/features/terminal/agent-status.store";

/**
 * Local heuristic that classifies what the agent is doing right now without
 * the agent itself emitting OSC sequences. cmux relies primarily on OSCs, but
 * Claude Code / Codex / Aider / etc. don't emit them yet — so we fall back to:
 *
 *   1. **Enter detection** — when the user submits a line via `\r` or `\n`,
 *      we flip the tab to `working`. Cheap, always right when wrong: the
 *      idle-decay below will repair it within ~800ms.
 *
 *   2. **Output silence** — when the PTY has been quiet for `idleAfterMs`,
 *      we either drop back to `idle` or, if the scrollback tail matches a
 *      confirm prompt, flip to `needs-attention`.
 *
 * OSC handlers (oscHandlers.ts) override this anytime — they're authoritative.
 */
export interface AgentHeuristicOpts {
  cliId?: string;
  /** Read the current status to know whether to write a new one. */
  getStatus: () => AgentStatus | undefined;
  /** Write a new status to the agent-status store. */
  setStatus: (status: AgentStatus, hint?: string) => void;
  /** Override the idle debounce. Defaults to 800ms. */
  idleAfterMs?: number;
  /** Override scrollback tail size scanned for confirm prompts. Default 50 lines. */
  tailLines?: number;
}

/** Regexes that mean "the agent is waiting for the user to type y/n/Enter". */
const CONFIRM_REGEXES: RegExp[] = [
  /Do you want to[\s\S]{0,80}?\[y\/n\]/i,
  /Continue\?\s*\(y\/n\)/i,
  /Press\s+(?:Enter|RETURN)[\s\S]{0,40}?to\s+(?:continue|approve)/i,
  /Approve this (?:action|command|edit)\?/i,
  /(?:Allow|Apply|Run) this (?:edit|change|command)\?/i,
  /\?\s*Continue/i,
  /❯\s*Yes,?[\s\S]{0,8}?\bNo\b/, // arrow-key Yes/No menus (Claude Code & Codex)
  /Tool use \(.*\) requires approval/i,
];

/**
 * Read the lines around the cursor — where an active confirm prompt lives. We
 * deliberately do NOT scan the whole scrollback tail: an already-answered prompt
 * that scrolled up a few lines must not keep re-matching and pinning the tab to
 * `needs-attention` forever. The prompt the agent is waiting on is on / just
 * above the row the cursor sits on.
 */
function readCursorVicinity(term: Terminal, lines: number): string {
  const buf = term.buffer.active;
  const cursorAbs = buf.baseY + buf.cursorY;
  const start = Math.max(0, cursorAbs - lines + 1);
  const end = Math.min(buf.length - 1, cursorAbs);
  const out: string[] = [];
  for (let i = start; i <= end; i++) {
    const ln = buf.getLine(i);
    if (ln) out.push(ln.translateToString(true));
  }
  return out.join("\n");
}

export function createAgentHeuristic(
  term: Terminal,
  opts: AgentHeuristicOpts,
): IDisposable {
  const idleAfterMs = opts.idleAfterMs ?? 800;
  // Tight window around the cursor: enough to span a multi-line prompt, small
  // enough that a scrolled-past, answered prompt no longer matches.
  const vicinityLines = opts.tailLines ?? 12;
  let idleTimer: number | null = null;
  // Did WE set the current `needs-attention`? If so we may clear it once the
  // prompt is gone. An OSC-driven needs-attention (authoritative) stays put.
  let attentionFromHeuristic = false;

  const writeListener = term.onWriteParsed(() => {
    if (idleTimer != null) {
      window.clearTimeout(idleTimer);
    }
    idleTimer = window.setTimeout(() => {
      const current = opts.getStatus();
      // Someone authoritative (OSC) changed the status out from under us; stop
      // claiming ownership of a needs-attention we no longer set.
      if (current !== "needs-attention") attentionFromHeuristic = false;

      const text = readCursorVicinity(term, vicinityLines);
      const matched = CONFIRM_REGEXES.find((re) => re.test(text));
      if (matched) {
        // Never override a `done` the agent just signalled via OSC.
        if (current === "done") return;
        const hint = (text.match(matched)?.[0] ?? "").slice(0, 80);
        opts.setStatus("needs-attention", hint);
        attentionFromHeuristic = true;
      } else if (current === "working") {
        opts.setStatus("idle");
      } else if (current === "needs-attention" && attentionFromHeuristic) {
        // The prompt we flagged is gone (answered / scrolled away) — recover.
        opts.setStatus("idle");
        attentionFromHeuristic = false;
      }
    }, idleAfterMs);
  });

  const inputListener = term.onData((d) => {
    // Match `\r`, `\n`, or a sequence ending with one of them. The check
    // covers both naked Enter (`\r`) and modified Enter sequences other than
    // Shift+Enter (which Terminal sends as `ESC \r` and we want to ignore).
    if (d === "\r" || d === "\n") {
      opts.setStatus("working");
    }
  });

  return {
    dispose() {
      writeListener.dispose();
      inputListener.dispose();
      if (idleTimer != null) {
        window.clearTimeout(idleTimer);
        idleTimer = null;
      }
    },
  };
}
