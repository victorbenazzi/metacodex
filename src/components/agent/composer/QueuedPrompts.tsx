import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { useAgentChatStore } from "@/features/agent/chat.store";

/**
 * Prompts waiting for the current turn to finish, shown as removable chips
 * inside the composer card. Clicking a chip's text pulls it back into the
 * composer for editing (its attachments don't survive the round-trip).
 */
export function QueuedPrompts() {
  const { t } = useTranslation();
  const queue = useAgentChatStore((s) => s.queue);

  if (queue.length === 0) return null;

  return (
    <div className="flex flex-col gap-[4px] px-[12px] pt-[10px]">
      <span className="text-[10.5px] uppercase tracking-[0.04em] text-muted-soft">
        {t("agent.composer.queue.queued", { count: queue.length })}
      </span>
      <div className="flex flex-wrap gap-[6px]">
        {queue.map((q) => (
          <span
            key={q.id}
            className="flex max-w-full items-center gap-[6px] rounded-md border border-hairline bg-surface-1 px-[8px] py-[4px] text-[12px]"
          >
            <button
              type="button"
              onClick={() => useAgentChatStore.getState().editQueued(q.id)}
              title={t("agent.composer.queue.edit")}
              className="max-w-[420px] truncate text-left text-body hover:text-ink"
            >
              {q.text || t("agent.composer.queue.attachmentsOnly")}
            </button>
            <button
              type="button"
              aria-label={t("agent.composer.queue.remove")}
              onClick={() => useAgentChatStore.getState().removeQueued(q.id)}
              className="shrink-0 rounded-sm p-[2px] text-muted-soft hover:bg-surface-2 hover:text-ink"
            >
              <Icon icon={X} size={11} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
