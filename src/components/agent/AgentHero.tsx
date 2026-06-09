import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { AgentComposer } from "@/components/agent/AgentComposer";

/**
 * Centered welcome state for the Agent View. Fraunces display headline echoes
 * the Welcome screen so the two top-level views read as one app. Sits slightly
 * above optical center, with the composer directly beneath.
 */
export function AgentHero() {
  const { t } = useTranslation();
  return (
    <div className="flex w-full max-w-[760px] flex-col items-center gap-[20px] -mt-[6vh]">
      <div className="flex flex-col items-center gap-[12px] text-center">
        <div className="flex items-center gap-[12px]">
          <span className="flex h-[40px] w-[40px] items-center justify-center rounded-lg bg-surface-2 text-ink">
            <Icon icon={Bot} size={22} strokeWidth={1.75} />
          </span>
          <h1 className="font-display text-[28px] leading-[1.1] tracking-[-0.01em] text-ink">
            {t("agent.hero.title")}
          </h1>
        </div>
      </div>
      <AgentComposer />
    </div>
  );
}
