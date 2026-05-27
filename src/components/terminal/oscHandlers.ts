import type { IDisposable, Terminal } from "@xterm/xterm";

/**
 * Hooks xterm's OSC parser into metacodex's agent surface. Sequences:
 *
 * - **OSC 0 / 1 / 2** — terminal/tab title. Emitted by Claude Code (OSC 0/2),
 *   Codex CLI (OSC 0), tmux, most shells. xterm.js' OSC parser handles both
 *   BEL and ST terminators transparently, so `data` is just the raw title
 *   string. Drives the tab's `agentTitle` override.
 *
 * - **OSC 7** — emitted by oh-my-zsh / starship / mosh / many shells on every
 *   directory change: `\e]7;file:///abs/path\e\\` (or BEL-terminated). Powers
 *   live `cwd` in the tab inspector + branch detection in source control.
 *
 * - **OSC 9** — iTerm-style "agent done" toast. Single string after
 *   `\e]9;`. We treat it as a `done` signal + (optional) banner.
 *
 * - **OSC 99** — cmux-style typed notification: `\e]99;<urgency>;<title>;<body>`
 *   where `urgency` ∈ {0,1,2,3}. Drives the `needs-attention` dot with color
 *   keyed off urgency.
 *
 * - **OSC 777** — VTE/GNOME notification: `\e]777;notify;<title>;<body>`.
 *   Treated similar to OSC 99 with urgency=1.
 *
 * Each handler returns `true` to consume the sequence (we don't want it
 * leaking through to the terminal buffer as random text).
 */
export interface OscPayloadNotify {
  /** Source sequence — for analytics / debugging. */
  source: "osc9" | "osc99" | "osc777";
  title: string;
  body?: string;
  /** 0=info, 1=warn, 2=danger, 3=critical. */
  urgency: number;
  /** True for OSC 9 (terminal explicitly signals "done"). */
  isDone: boolean;
  /** Hint whether the dispatcher should play sound, derived from urgency. */
  sound: boolean;
}

export interface OscHandlerOpts {
  onNotify: (payload: OscPayloadNotify) => void;
  onCwd: (path: string) => void;
  /** Raw title from OSC 0/1/2 — sanitization is the caller's job (it's the
   *  only one that knows the tab's `defaultTitle` to compare against). */
  onTitle: (raw: string) => void;
}

function clampUrgency(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "0", 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, n));
}

function decodeFileUri(uri: string): string | null {
  const trimmed = uri.trim();
  if (!trimmed.startsWith("file://")) return null;
  // file://host/path — we ignore host (typically empty or "localhost").
  const slashIdx = trimmed.indexOf("/", "file://".length);
  if (slashIdx === -1) return null;
  try {
    return decodeURIComponent(trimmed.slice(slashIdx));
  } catch {
    return null;
  }
}

export function installOscHandlers(term: Terminal, opts: OscHandlerOpts): IDisposable[] {
  const disposables: IDisposable[] = [];

  // OSC 0 / 1 / 2 — window/icon title. Treat all three the same; the only
  // distinction at the protocol level is which one the terminal surfaces in
  // its chrome (window vs icon), which doesn't apply here.
  for (const code of [0, 1, 2]) {
    disposables.push(
      term.parser.registerOscHandler(code, (data) => {
        opts.onTitle(data);
        return true;
      }),
    );
  }

  // OSC 7 — cwd. `data` is the full URI (everything between `OSC 7;` and ST/BEL).
  disposables.push(
    term.parser.registerOscHandler(7, (data) => {
      const path = decodeFileUri(data);
      if (path) opts.onCwd(path);
      return true;
    }),
  );

  // OSC 9 — iTerm toast. Body is everything after `OSC 9;`.
  disposables.push(
    term.parser.registerOscHandler(9, (data) => {
      const body = data.trim();
      opts.onNotify({
        source: "osc9",
        title: "Agent finished",
        body: body || undefined,
        urgency: 0,
        isDone: true,
        sound: true,
      });
      return true;
    }),
  );

  // OSC 99 — typed: `<urgency>;<title>;<body?>`.
  disposables.push(
    term.parser.registerOscHandler(99, (data) => {
      const [u, title, body] = data.split(";");
      const urgency = clampUrgency(u);
      opts.onNotify({
        source: "osc99",
        title: title || "Agent message",
        body: body || undefined,
        urgency,
        isDone: false,
        sound: urgency >= 2,
      });
      return true;
    }),
  );

  // OSC 777 — VTE: `notify;<title>;<body>`. Anything else we let pass through.
  disposables.push(
    term.parser.registerOscHandler(777, (data) => {
      const parts = data.split(";");
      if (parts[0] !== "notify") return false;
      opts.onNotify({
        source: "osc777",
        title: parts[1] ?? "Agent message",
        body: parts[2] || undefined,
        urgency: 1,
        isDone: false,
        sound: false,
      });
      return true;
    }),
  );

  return disposables;
}
