import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

/**
 * Apply fit + canvas redraw + viewport scroll-area sync.
 *
 * Load-bearing for WKWebView (see runFitOnVisible):
 *  - `fit.fit()` only calls `term.resize()` when dimensions change; if
 *    rows/cols match the pre-hide values, the CanvasAddon never repaints.
 *  - The same no-op fit skips xterm's `_afterResize` →
 *    `viewport.syncScrollArea(true)`, so mouse-wheel scroll can die until
 *    the buffer grows again. We poke the private viewport sync after every fit.
 */
export function applyTerminalFit(term: Terminal, fit: FitAddon): void {
  fit.fit();
  term.refresh(0, Math.max(0, term.rows - 1));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (term as any)._core?.viewport?.syncScrollArea?.(true);
}

export interface FitOnVisibleArgs {
  term: Terminal;
  fit: FitAddon;
  getContainer: () => HTMLElement | null;
  /** When true, scroll to bottom after a successful fit (tab became visible). */
  scrollToBottom?: boolean;
}

/**
 * When a Process tab transitions from hidden (`display:none`) to visible, the
 * container resumes having a real size, but WKWebView's ResizeObserver
 * sometimes misses that transition, so the xterm renderer keeps the cols/rows
 * it had pre-hide (possibly 0 if it was first hidden). The result is content
 * clipped at the bottom and a PTY out of sync with the visible viewport.
 *
 * Three regressions worth guarding (all observed in WKWebView):
 *   1. Layout can report a transient size for 1-2 frames after `display:block`
 *      lands; if we fit on the first frame, we may lock in the wrong rows.
 *      We poll across frames until the size stabilizes (same value twice).
 *   2. No-op fit leaves CanvasAddon pixel cache stale (see applyTerminalFit).
 *   3. No-op fit leaves viewport scroll area stale (see applyTerminalFit).
 *
 * Returns a cancel function for the rAF poll (call on hide or unmount).
 */
export function runFitOnVisible({
  term,
  fit,
  getContainer,
  scrollToBottom = true,
}: FitOnVisibleArgs): () => void {
  let cancelled = false;
  let attempts = 0;
  let lastW = 0;
  let lastH = 0;
  let stableFrames = 0;

  const tick = () => {
    if (cancelled) return;
    const container = getContainer();
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) {
      if (attempts++ < 30) requestAnimationFrame(tick);
      return;
    }
    if (w === lastW && h === lastH) {
      stableFrames++;
    } else {
      stableFrames = 0;
      lastW = w;
      lastH = h;
    }
    // Two stable frames OR ~16 attempts (~250ms), whichever first.
    if (stableFrames < 2 && attempts++ < 16) {
      requestAnimationFrame(tick);
      return;
    }
    try {
      applyTerminalFit(term, fit);
      if (scrollToBottom) term.scrollToBottom();
    } catch {
      // ignore; ResizeObserver path will retry
    }
  };

  requestAnimationFrame(tick);
  return () => {
    cancelled = true;
  };
}
