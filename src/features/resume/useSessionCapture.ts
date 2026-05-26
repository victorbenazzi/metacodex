import { useEffect } from "react";
import type { Terminal } from "@xterm/xterm";

import { useResumeStore } from "./resume.store";
import { detectorFor } from "./sessionDetectors";
import { useTabMetadataStore } from "@/features/terminal/tabMetadata.store";

interface UseSessionCaptureOpts {
  enabled: boolean;
  term: Terminal | null;
  cliId?: string;
  projectId: string | null;
  cwd: string;
  /** PTY session id — used to look up the live cwd/branch in the metadata store. */
  sessionId: string | null;
}

const TAIL_LINES = 200;
const DEBOUNCE_MS = 1500;

function readTail(term: Terminal): string {
  const buf = term.buffer.active;
  const start = Math.max(0, buf.length - TAIL_LINES);
  const out: string[] = [];
  for (let i = start; i < buf.length; i++) {
    const ln = buf.getLine(i);
    if (ln) out.push(ln.translateToString(true));
  }
  return out.join("\n");
}

/**
 * Watches a CLI tab's scrollback for a printed session id and saves it to the
 * resume registry. Disabled when the agent has no detector (e.g. Aider).
 *
 * Implementation notes:
 *   - We scan the buffer tail on `onWriteParsed`, debounced 1.5s. That's slow
 *     enough that startup banners settle and fast enough that the user sees
 *     the entry appear before they close the tab.
 *   - First match per (tabId, cliId) wins — we cache the detected id in a ref
 *     to avoid spamming the IPC.
 *   - When the metadata store has a fresher cwd (after `cd`) or branch, we
 *     use that — keeps resume entries pointing at the right thing.
 */
export function useSessionCapture(opts: UseSessionCaptureOpts) {
  const { enabled, term, cliId, projectId, cwd, sessionId } = opts;

  useEffect(() => {
    if (!enabled || !term) return;
    const detector = detectorFor(cliId);
    if (!detector) return;

    let timer: number | null = null;
    let captured: string | null = null;

    const tryCapture = () => {
      timer = null;
      if (captured) return;
      const result = detector(readTail(term));
      if (!result) return;
      captured = result.sessionId;
      // Prefer fresh metadata if available; fallback to spawn-time values.
      const meta = sessionId
        ? useTabMetadataStore.getState().bySessionId[sessionId]
        : undefined;
      void useResumeStore.getState().save({
        projectId,
        cliId: cliId ?? "",
        sessionId: captured,
        cwd: meta?.cwd ?? cwd,
        branch: meta?.branch ?? null,
      }).catch((err) => {
        console.warn("[resume] save failed", err);
        captured = null; // allow retry
      });
    };

    const disposable = term.onWriteParsed(() => {
      if (timer != null) return;
      timer = window.setTimeout(tryCapture, DEBOUNCE_MS);
    });

    return () => {
      disposable.dispose();
      if (timer != null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, term, cliId, projectId, sessionId]);
}
