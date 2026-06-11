import { useTranslation } from "react-i18next";

import { Tooltip } from "@/components/ui/Tooltip";
import { useAgentStatusStore } from "@/features/terminal/agent-status.store";
import { cn } from "@/lib/cn";

interface TabStatusDotProps {
  tabId: string;
}

/**
 * Compact 6px dot that lives next to a process tab's title. Reads its state
 * from `useAgentStatusStore` — the OSC handlers + heuristic + PTY-exit listener
 * in `TerminalTab.tsx` are the writers.
 *
 * UX choices:
 *   - `idle`: render nothing. Most tabs are idle most of the time; the row
 *     should read as quiet.
 *   - `working`: low-key gray, slow opacity pulse. Visible but not distracting.
 *   - `needs-attention`: static warn dot (urgency 0/1) or danger (2/3). Static
 *     so a long-running unanswered prompt doesn't keep moving in peripheral
 *     vision — but doesn't blend in either.
 *   - `done`: solid success green. Auto-clears after 4s upstream.
 *
 * The dot itself is hover-targetable via the Tooltip — useful when a tab title
 * is truncated and the user wants to know what the agent's waiting on.
 */
export function TabStatusDot({ tabId }: TabStatusDotProps) {
  const { t } = useTranslation();
  const entry = useAgentStatusStore((s) => s.byTab[tabId]);
  if (!entry || entry.status === "idle") return null;

  let toneClass = "";
  let pulse = false;
  let labelKey = "tabs.status.idle";
  switch (entry.status) {
    case "working":
      toneClass = "bg-muted";
      pulse = true;
      labelKey = "tabs.status.working";
      break;
    case "needs-attention":
      toneClass = (entry.urgency ?? 0) >= 2 ? "bg-danger" : "bg-warn";
      labelKey = "tabs.status.needsAttention";
      break;
    case "done":
      toneClass = "bg-success";
      labelKey = "tabs.status.done";
      break;
  }

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-[2px]">
          <span className="font-medium">{t(labelKey)}</span>
          {entry.hint ? (
            <span className="font-mono text-[10px] text-muted">{entry.hint}</span>
          ) : null}
        </span>
      }
      side="bottom"
    >
      <span
        aria-label={t(labelKey)}
        aria-live="polite"
        className={cn(
          "inline-block h-[6px] w-[6px] shrink-0 rounded-pill",
          toneClass,
          pulse && "animate-tab-status-pulse",
        )}
      />
    </Tooltip>
  );
}
