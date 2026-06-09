import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Plus, Square } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { cn } from "@/lib/cn";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import type { AgentMode } from "@/features/agent/opencode";

import { ModelPicker } from "./composer/ModelPicker";
import { ProjectPicker } from "./composer/ProjectPicker";
import { PermissionPicker } from "./composer/PermissionPicker";
import { BranchPicker } from "./composer/BranchPicker";

/** Tallest the textarea grows before it starts scrolling internally. */
const MAX_TEXTAREA_PX = 200;

/**
 * The Agent View composer. Sends prompts to the opencode runtime via the chat
 * store; the reply streams back through the shared event subscription. The
 * control cluster (model, project, permission, mode) drives the harness for
 * real: each choice rides the next session/message to opencode.
 *
 * Auto-grows with the prompt up to `MAX_TEXTAREA_PX`, then scrolls. `compact`
 * is the docked-below-the-thread variant: a slimmer, Cursor-like footprint that
 * keeps every control, used once the conversation has started.
 */
export function AgentComposer({
  autoFocus,
  compact,
}: {
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const send = useAgentChatStore((s) => s.send);
  const stop = useAgentChatStore((s) => s.stop);
  const status = useAgentChatStore((s) => s.status);
  const mode = useSettingsDataStore((s) => s.settings.agent.mode);
  const update = useSettingsDataStore((s) => s.update);
  const directory = useAgentChatStore((s) => s.directory);

  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const busy = status === "submitted" || status === "streaming";

  // Grow to fit the content, capped at MAX (past which the textarea scrolls).
  // Runs on every text change, including the reset to "" after submit.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    void send(value);
  };

  return (
    <div className="w-full max-w-[760px]">
      <div className="rounded-xl border border-hairline bg-surface-card shadow-elevated">
        <textarea
          ref={taRef}
          value={text}
          autoFocus={autoFocus}
          rows={1}
          placeholder={t("agent.composer.placeholder")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          style={{ maxHeight: MAX_TEXTAREA_PX }}
          className={cn(
            "block w-full resize-none overflow-y-auto bg-transparent text-[14px] leading-[1.5] text-ink outline-none placeholder:text-muted-soft",
            compact ? "min-h-[40px] px-[14px] pt-[10px]" : "min-h-[64px] px-[16px] pt-[14px]",
          )}
        />

        <div
          className={cn(
            "flex items-center gap-[8px]",
            compact ? "px-[10px] pb-[10px] pt-[2px]" : "px-[12px] pb-[12px] pt-[4px]",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-[8px]">
            <button
              type="button"
              disabled
              aria-label={t("agent.composer.attach")}
              className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-hairline text-muted disabled:opacity-50"
            >
              <Icon icon={Plus} size={16} strokeWidth={2} />
            </button>
            <ModelPicker />
            <PermissionPicker />
          </div>

          <div className="flex shrink-0 items-center gap-[10px]">
            <Segmented
              size="sm"
              ariaLabel={t("agent.composer.modeLabel")}
              value={mode}
              onChange={(value: AgentMode) => update("agent", { mode: value })}
              options={[
                { value: "agent", label: t("agent.composer.agent") },
                { value: "swarm", label: t("agent.composer.agentSwarm") },
              ]}
            />
            {busy ? (
              <button
                type="button"
                onClick={() => void stop()}
                aria-label={t("agent.composer.stop")}
                className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full bg-ink text-on-primary"
              >
                <Icon icon={Square} size={12} strokeWidth={3} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!text.trim()}
                aria-label={t("agent.composer.send")}
                className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full bg-ink text-on-primary disabled:bg-surface-2 disabled:text-muted-soft"
              >
                <Icon icon={ArrowUp} size={16} strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-[8px] flex items-center gap-[8px] px-[2px]">
        <ProjectPicker />
        {directory ? (
          <>
            <span className="h-[12px] w-px shrink-0 bg-hairline" />
            <BranchPicker root={directory} />
          </>
        ) : null}
      </div>
    </div>
  );
}
