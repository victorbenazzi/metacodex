import type { ITerminalAddon, Terminal } from "@xterm/xterm";

const DEAD_KEYS = new Set(["Dead", "AltGraph"]);
const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift"]);
const COMPOSITION_KEY_CODE = 229;

/** WebView2 identifies as AppleWebKit too, so exclude Chromium hosts explicitly. */
export function isWebKitEngine(userAgent: string): boolean {
  return /AppleWebKit/i.test(userAgent) && !/(?:Chrom(?:e|ium)|CriOS|Edg|OPR)\//i.test(userAgent);
}

function currentUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent || "";
}

/**
 * Repairs dead-key event sequences emitted by WebKit-based Tauri webviews.
 *
 * xterm already owns composition and emits the committed character. Some
 * WebKit sequences then expose the same physical key again as a synthetic
 * keydown or keypress, which makes xterm emit the commit a second time. When
 * WebKit concatenates the committed dead key and the following physical key,
 * xterm also drops that following key because it is not a single character.
 *
 * This addon only recognizes a composition that contained a real `Dead` or
 * `AltGraph` keydown. It therefore leaves ordinary IME commits and directly
 * typed accent characters on xterm's normal path.
 *
 * Upstream context: https://github.com/xtermjs/xterm.js/issues/5894
 */
export class WebKitDeadKeyAddon implements ITerminalAddon {
  private readonly enabled: boolean;
  private terminal: Terminal | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private canResetTextarea = false;
  private composing = false;
  private pendingDeadKey = false;
  private deadKeyInComposition = false;
  private commit: string | null = null;

  constructor(enabled = isWebKitEngine(currentUserAgent())) {
    this.enabled = enabled;
  }

  public activate(terminal: Terminal): void {
    if (!this.enabled) return;

    this.terminal = terminal;
    this.textarea = terminal.textarea ?? null;
    this.canResetTextarea = terminal.options.screenReaderMode !== true;
    this.textarea?.addEventListener("compositionstart", this.onCompositionStart, true);
    this.textarea?.addEventListener("compositionend", this.onCompositionEnd, true);
    this.textarea?.addEventListener("blur", this.onBlur, true);
  }

  public dispose(): void {
    this.textarea?.removeEventListener("compositionstart", this.onCompositionStart, true);
    this.textarea?.removeEventListener("compositionend", this.onCompositionEnd, true);
    this.textarea?.removeEventListener("blur", this.onBlur, true);
    this.terminal = null;
    this.textarea = null;
    this.canResetTextarea = false;
    this.reset();
  }

  /** Returns true when the host should keep xterm from processing the event. */
  public intercept(event: KeyboardEvent): boolean {
    if (!this.enabled) return false;

    // xterm's hidden textarea can retain earlier input. A keyCode 229 fallback
    // may then emit that entire retained value instead of only the new commit.
    // Clear it before xterm snapshots the value, while preserving the buffer
    // required by screen readers.
    if (
      event.type === "keydown" &&
      event.keyCode === COMPOSITION_KEY_CODE &&
      !this.composing
    ) {
      this.resetTextarea();
    }

    if (event.type === "keydown" && DEAD_KEYS.has(event.key)) {
      if (!this.composing) this.resetTextarea();
      if (this.composing) this.deadKeyInComposition = true;
      else this.pendingDeadKey = true;
      return false;
    }

    if (event.type === "keydown" && this.commit !== null) {
      if (event.key === this.commit) return true;

      const trailingKey = this.trailingKey(event.key);
      if (trailingKey !== null) {
        this.terminal?.input(trailingKey, true);
        return true;
      }

      if (!MODIFIER_KEYS.has(event.key)) this.commit = null;
      return false;
    }

    if (event.type === "keypress" && this.commit !== null) {
      const text = event.charCode ? String.fromCharCode(event.charCode) : event.key;
      const isDuplicate = text === this.commit;
      this.commit = null;
      return isDuplicate;
    }

    if (event.type === "keyup" && this.commit !== null && !MODIFIER_KEYS.has(event.key)) {
      this.commit = null;
    }

    if (
      event.type === "keydown" &&
      !this.composing &&
      !MODIFIER_KEYS.has(event.key)
    ) {
      this.pendingDeadKey = false;
    }

    return false;
  }

  private trailingKey(key: string): string | null {
    if (this.commit === null || !key.startsWith(this.commit)) return null;
    const trailing = key.slice(this.commit.length);
    return Array.from(trailing).length === 1 ? trailing : null;
  }

  private readonly onCompositionStart = (): void => {
    // This capture listener runs before xterm records the composition start
    // offset. Starting from an empty textarea prevents stale text from being
    // replayed by CompositionHelper without changing terminal output.
    this.resetTextarea();
    this.composing = true;
    this.deadKeyInComposition = this.pendingDeadKey;
    this.pendingDeadKey = false;
    this.commit = null;
  };

  private readonly onCompositionEnd = (event: CompositionEvent): void => {
    this.composing = false;
    this.commit = this.deadKeyInComposition && event.data ? event.data : null;
    this.deadKeyInComposition = false;
    this.pendingDeadKey = false;
  };

  private readonly onBlur = (): void => this.reset();

  private resetTextarea(): void {
    if (this.canResetTextarea && this.textarea) this.textarea.value = "";
  }

  private reset(): void {
    this.composing = false;
    this.pendingDeadKey = false;
    this.deadKeyInComposition = false;
    this.commit = null;
  }
}
