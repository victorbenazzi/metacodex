import type { IDisposable, Terminal } from "@xterm/xterm";

import type { AgentStatus } from "@/features/terminal/agent-status.store";
import {
  firstMatch,
  resolveAttentionProfile,
  type AttentionProfile,
} from "@/features/terminal/attentionProfile";

/**
 * Classifies what a process tab is doing when the CLI does not emit OSC 99.
 *
 * CLI tabs (`cliId` set): output or Enter → `working`; real silence →
 * `needs-attention` (your turn). Spinner copy can hold `working`. Confirm
 * regexes still force attention if the TUI never goes quiet.
 *
 * Shell tabs: Enter → `working`; silence → `idle`, unless a confirm prompt
 * sits on the cursor.
 *
 * OSC handlers override this. They are authoritative.
 */
export interface AgentHeuristicOpts {
  cliId?: string;
  getStatus: () => AgentStatus | undefined;
  setStatus: (status: AgentStatus, hint?: string) => void;
}

export type QuietDecision =
  | { action: "working" }
  | { action: "needs-attention"; hint?: string }
  | { action: "idle" }
  | { action: "keep" };

const VICINITY_LINES = 12;

interface ScheduledDeadline {
  at: number;
  run: () => void;
}

class SharedDeadlineScheduler {
  private readonly deadlines = new Map<symbol, ScheduledDeadline>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  schedule(key: symbol, delayMs: number, run: () => void): void {
    this.deadlines.set(key, { at: Date.now() + delayMs, run });
    this.arm();
  }

  cancel(key: symbol): void {
    this.deadlines.delete(key);
    this.arm();
  }

  pendingCount(): number {
    return this.deadlines.size;
  }

  private arm(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    let nextAt = Number.POSITIVE_INFINITY;
    for (const deadline of this.deadlines.values()) {
      nextAt = Math.min(nextAt, deadline.at);
    }
    if (!Number.isFinite(nextAt)) return;
    this.timer = setTimeout(() => this.flush(), Math.max(0, nextAt - Date.now()));
  }

  private flush(): void {
    this.timer = null;
    const now = Date.now();
    const due: ScheduledDeadline[] = [];
    for (const [key, deadline] of this.deadlines) {
      if (deadline.at <= now) {
        this.deadlines.delete(key);
        due.push(deadline);
      }
    }
    this.arm();
    for (const deadline of due) deadline.run();
  }
}

const quietScheduler = new SharedDeadlineScheduler();

export function pendingAgentHeuristicDeadlines(): number {
  return quietScheduler.pendingCount();
}

function fromVicinity(vicinity: string, profile: AttentionProfile): QuietDecision | null {
  if (firstMatch(vicinity, profile.workingPatterns)) {
    return { action: "working" };
  }
  const attentionHint = firstMatch(vicinity, profile.attentionPatterns);
  if (attentionHint) return { action: "needs-attention", hint: attentionHint };
  return null;
}

export function classifyCliQuiet(args: {
  current: AgentStatus | undefined;
  vicinity: string;
  profile: AttentionProfile;
}): QuietDecision {
  if (args.current === "done") return { action: "keep" };
  const hit = fromVicinity(args.vicinity, args.profile);
  if (hit) return hit;
  if (args.current === "working") return { action: "needs-attention" };
  return { action: "keep" };
}

export function classifyShellQuiet(args: {
  current: AgentStatus | undefined;
  vicinity: string;
  profile: AttentionProfile;
  attentionFromHeuristic: boolean;
}): QuietDecision {
  if (args.current === "done") return { action: "keep" };
  const hit = fromVicinity(args.vicinity, args.profile);
  if (hit) return hit;
  if (args.current === "working") return { action: "idle" };
  if (args.current === "needs-attention" && args.attentionFromHeuristic) {
    return { action: "idle" };
  }
  return { action: "keep" };
}

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
  const isCli = Boolean(opts.cliId);
  const profile = resolveAttentionProfile(opts.cliId);
  const deadlineKey = Symbol("agent-quiet-deadline");
  let attentionFromHeuristic = false;

  const applyQuiet = () => {
    const current = opts.getStatus();
    if (current !== "needs-attention") attentionFromHeuristic = false;

    const vicinity = readCursorVicinity(term, VICINITY_LINES);
    const decision = isCli
      ? classifyCliQuiet({ current, vicinity, profile })
      : classifyShellQuiet({
          current,
          vicinity,
          profile,
          attentionFromHeuristic,
        });

    if (decision.action === "keep") return;
    if (decision.action === "needs-attention") {
      opts.setStatus("needs-attention", decision.hint);
      attentionFromHeuristic = true;
      return;
    }
    if (decision.action === "working") {
      opts.setStatus("working");
      attentionFromHeuristic = false;
      return;
    }
    opts.setStatus("idle");
    attentionFromHeuristic = false;
  };

  const writeListener = term.onWriteParsed(() => {
    const current = opts.getStatus();
    // Fresh output on a CLI tab means the agent is busy, except when we
    // already flagged attention: TUIs redraw the idle prompt and must not
    // bounce yellow → gray → yellow. Enter is what resumes working.
    if (isCli && current !== "done" && current !== "needs-attention") {
      opts.setStatus("working");
    }

    quietScheduler.schedule(deadlineKey, profile.quietAfterMs, applyQuiet);
  });

  const inputListener = term.onData((d) => {
    if (d === "\r" || d === "\n") {
      attentionFromHeuristic = false;
      opts.setStatus("working");
    }
  });

  return {
    dispose() {
      writeListener.dispose();
      inputListener.dispose();
      quietScheduler.cancel(deadlineKey);
    },
  };
}
