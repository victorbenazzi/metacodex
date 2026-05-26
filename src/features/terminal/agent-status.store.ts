import { create } from "zustand";

/**
 * Per-tab agent status — drives the dot on the tab bar, the Cmd+Shift+U
 * jump-to-next-attention shortcut, and the dispatch of OS notifications.
 *
 * Modeled on what cmux exposes to the user:
 *   - `idle`            → no halo, no badge. Default.
 *   - `working`         → soft pulse (opacity 0.4↔0.7) cinza. Set by the
 *                          heuristic when the user presses Enter and the PTY
 *                          starts producing output.
 *   - `needs-attention` → static yellow dot. Set by OSC 99/777 or by the
 *                          confirm-prompt regex in `agentHeuristic.ts`.
 *   - `done`            → green dot for ~4s, then auto-clears. Set by OSC 9
 *                          or by the PTY exit event.
 *
 * The status lives separate from the tabs store on purpose: it's purely
 * ephemeral (we never serialize it) and tab bucketing should not re-render
 * when only the status changes.
 */
export type AgentStatus = "idle" | "working" | "needs-attention" | "done";

export interface AgentStatusEntry {
  status: AgentStatus;
  /** epoch ms — drives the auto-clear of `done` and ordering of `needs-attention` in jump-to-next. */
  changedAt: number;
  /** Short hint displayed in tooltip — OSC 9 body, or the matched regex tail. */
  hint?: string;
  /** OSC 99 urgency 0..3. Affects color of the `needs-attention` dot. */
  urgency?: number;
}

interface AgentStatusState {
  byTab: Record<string, AgentStatusEntry>;
  setStatus: (tabId: string, status: AgentStatus, hint?: string, urgency?: number) => void;
  clear: (tabId: string) => void;
  get: (tabId: string) => AgentStatusEntry | undefined;
}

export const useAgentStatusStore = create<AgentStatusState>((set, get) => ({
  byTab: {},

  setStatus: (tabId, status, hint, urgency) =>
    set((state) => ({
      byTab: {
        ...state.byTab,
        [tabId]: {
          status,
          changedAt: Date.now(),
          hint,
          urgency,
        },
      },
    })),

  clear: (tabId) =>
    set((state) => {
      if (!(tabId in state.byTab)) return state;
      const { [tabId]: _, ...rest } = state.byTab;
      return { byTab: rest };
    }),

  get: (tabId) => get().byTab[tabId],
}));

/**
 * Order tabs for the jump-to-next-attention shortcut.
 *
 * Priority:
 *   1. `needs-attention` first, ordered by urgency desc, then changedAt desc.
 *   2. `done` next, ordered by changedAt desc.
 *   3. Anything else is ignored.
 *
 * Returns an ordered list of tabIds the user should walk through.
 */
export function attentionOrder(byTab: Record<string, AgentStatusEntry>): string[] {
  const needs: Array<[string, AgentStatusEntry]> = [];
  const done: Array<[string, AgentStatusEntry]> = [];
  for (const [tabId, entry] of Object.entries(byTab)) {
    if (entry.status === "needs-attention") needs.push([tabId, entry]);
    else if (entry.status === "done") done.push([tabId, entry]);
  }
  needs.sort((a, b) => {
    const ua = a[1].urgency ?? 0;
    const ub = b[1].urgency ?? 0;
    if (ua !== ub) return ub - ua;
    return b[1].changedAt - a[1].changedAt;
  });
  done.sort((a, b) => b[1].changedAt - a[1].changedAt);
  return [...needs.map(([id]) => id), ...done.map(([id]) => id)];
}
