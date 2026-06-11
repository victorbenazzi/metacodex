import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useAgentChatStore } from "@/features/agent/chat.store";

/** The meter only appears once the window is meaningfully consumed. */
const SHOW_AT = 0.5;
const WARN_AT = 0.8;
const DANGER_AT = 0.95;

/**
 * Thin context-window gauge docked above the composer: invisible below 50%,
 * amber past 80%, plus the "Compact conversation" action. Usage is an estimate
 * from the last turn's token accounting (the harness exposes no usage
 * endpoint), so the tooltip says so.
 */
export function ContextMeter() {
  const { t } = useTranslation();
  const usage = useAgentChatStore((s) => s.contextUsage);
  const compacting = useAgentChatStore((s) => s.compacting);
  const status = useAgentChatStore((s) => s.status);

  const ratio = usage && usage.limit > 0 ? usage.used / usage.limit : 0;
  if (!usage || ratio < SHOW_AT) return null;

  const percent = Math.min(100, Math.round(ratio * 100));
  const busy = status !== "idle";

  return (
    <div
      className="mb-[8px] flex items-center gap-[10px]"
      title={t("agent.chat.context.usage", { percent })}
    >
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t("agent.chat.context.usage", { percent })}
        className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            ratio >= DANGER_AT ? "bg-danger" : ratio >= WARN_AT ? "bg-warn" : "bg-ink/30",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-soft">{percent}%</span>
      <button
        type="button"
        disabled={busy || compacting}
        onClick={() => void useAgentChatStore.getState().compact()}
        className="inline-flex shrink-0 items-center gap-[5px] rounded-md px-[6px] py-[2px] text-[11px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        {compacting ? <Icon icon={Loader2} size={11} className="animate-spin" /> : null}
        {compacting ? t("agent.chat.context.compacting") : t("agent.chat.context.compact")}
      </button>
    </div>
  );
}
