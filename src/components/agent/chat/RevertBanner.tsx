import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RotateCcw } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { useAgentChatStore } from "@/features/agent/chat.store";

/**
 * Persistent strip shown while the session sits on a revert checkpoint:
 * "conversation restored, N messages discarded, [Undo]". Lives OUTSIDE the
 * thread scroller (always visible), and disappears the moment the revert is
 * undone or cleared (e.g. a new message finalizes it).
 */
export function RevertBanner() {
  const { t } = useTranslation();
  const revert = useAgentChatStore((s) => s.revert);
  const status = useAgentChatStore((s) => s.status);
  const [pending, setPending] = useState(false);

  if (!revert) return null;
  const count = revert.droppedCount ?? 0;

  return (
    <div className="border-t border-hairline-soft bg-surface-1 animate-fade-in">
      <div className="mx-auto flex w-full max-w-[760px] items-center gap-[10px] px-[20px] py-[8px]">
        <Icon icon={RotateCcw} size={13} className="shrink-0 text-warn" />
        <span className="min-w-0 flex-1 truncate text-caption text-muted">
          {count > 0
            ? t("agent.chat.revert.activeBanner", { count })
            : t("agent.chat.revert.activeBannerNoCount")}
        </span>
        <button
          type="button"
          disabled={status !== "idle" || pending}
          onClick={() => {
            setPending(true);
            void useAgentChatStore
              .getState()
              .unrevert()
              .finally(() => setPending(false));
          }}
          className="inline-flex shrink-0 items-center gap-[6px] rounded-md border border-hairline px-[10px] py-[3px] text-caption text-ink hover:bg-surface-2 disabled:opacity-40"
        >
          {pending ? <Icon icon={Loader2} size={12} className="animate-spin" /> : null}
          {t("agent.chat.revert.undo")}
        </button>
      </div>
    </div>
  );
}
