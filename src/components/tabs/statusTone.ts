import type { AgentStatus } from "@/features/terminal/agent-status.store";

export interface StatusTone {
  toneClass: string;
  pulse: boolean;
  labelKey: string;
}

/**
 * Visual grammar for the agent-status dots. One mapping shared by every
 * surface that renders a status dot (tab bar, sidebar rows, project rail
 * tiles) so they all speak the same color language:
 *   - `working`         → low-key gray, slow opacity pulse.
 *   - `needs-attention` → static warn dot (urgency 0/1) or danger (2/3).
 *   - `done`            → solid success green (auto-cleared upstream).
 *   - `idle`            → null: render nothing, rows should read as quiet.
 */
export function statusTone(status: AgentStatus, urgency?: number): StatusTone | null {
  switch (status) {
    case "working":
      return { toneClass: "bg-muted", pulse: true, labelKey: "tabs.status.working" };
    case "needs-attention":
      return {
        toneClass: (urgency ?? 0) >= 2 ? "bg-danger" : "bg-warn",
        pulse: false,
        labelKey: "tabs.status.needsAttention",
      };
    case "done":
      return { toneClass: "bg-success", pulse: false, labelKey: "tabs.status.done" };
    default:
      return null;
  }
}
