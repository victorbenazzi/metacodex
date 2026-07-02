import { statusTone } from "@/components/tabs/statusTone";
import type { AgentStatus } from "@/features/terminal/agent-status.store";
import { cn } from "@/lib/cn";

/**
 * The project-level status dot (aggregated across the project's sessions by
 * `useProjectAgentStatus`). Purely presentational: the caller decides the
 * accessible wrapper — the expanded sidebar row wraps it in a Tooltip with a
 * label, the rail tile keeps it decorative and folds the status into the
 * tile's own tooltip. Pass `label` to expose it to assistive tech.
 */
export function ProjectStatusDot({
  status,
  urgency,
  label,
  className,
}: {
  status: AgentStatus;
  urgency?: number;
  label?: string;
  className?: string;
}) {
  const tone = statusTone(status, urgency);
  if (!tone) return null;
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn(
        "inline-block h-[6px] w-[6px] shrink-0 rounded-pill",
        tone.toneClass,
        tone.pulse && "animate-tab-status-pulse motion-reduce:animate-none",
        className,
      )}
    />
  );
}
