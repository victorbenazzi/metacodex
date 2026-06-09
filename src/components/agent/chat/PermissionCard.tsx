import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useAgentChatStore } from "@/features/agent/chat.store";
import type { PermissionPrompt } from "@/features/agent/opencode";

/**
 * Inline approval for a live opencode permission request. Surfaced in the thread
 * when the agent wants to run a gated tool (edit, bash, …). Three replies map to
 * opencode's verbs: Deny → `reject`, Allow once → `once`, Allow always →
 * `always`. The card is calm: an amber glyph, the action and its targets, and a
 * clear primary on "Allow once" so the common path is one obvious click.
 */
export function PermissionCard({ prompt }: { prompt: PermissionPrompt }) {
  const { t } = useTranslation();
  const reply = useAgentChatStore((s) => s.replyPermission);

  const extra = prompt.targets.length - 1;
  const target = prompt.targets[0];

  return (
    <div className="rounded-lg border border-hairline bg-surface-card p-[14px] shadow-elevated">
      <div className="flex items-start gap-[10px]">
        <span className="mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-warn/12 text-warn">
          <Icon icon={ShieldAlert} size={14} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{t("agent.permission.requestTitle")}</p>
          <p className="mt-[2px] flex flex-wrap items-center gap-x-[6px] gap-y-[2px] text-[12px] text-body">
            {t("agent.permission.requestBody")}
            <code className="rounded-sm bg-surface-2 px-[6px] py-[1px] font-mono text-[11px] text-ink">
              {prompt.action}
            </code>
            {target ? (
              <span className="min-w-0 truncate font-mono text-[11px] text-muted">
                {target}
                {extra > 0 ? ` ${t("agent.permission.moreTargets", { count: extra })}` : ""}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="mt-[12px] flex items-center justify-end gap-[8px]">
        <Button size="sm" variant="ghost" onClick={() => void reply(prompt.id, "reject")}>
          {t("agent.permission.deny")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void reply(prompt.id, "always")}>
          {t("agent.permission.allowAlways")}
        </Button>
        <Button size="sm" variant="primary" onClick={() => void reply(prompt.id, "once")}>
          {t("agent.permission.allowOnce")}
        </Button>
      </div>
    </div>
  );
}
