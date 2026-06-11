import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import {
  useAgentChatStore,
  type ChatMessage as Msg,
  type ChildSession,
} from "@/features/agent/chat.store";
import { ChatMessage } from "./ChatMessage";

/**
 * One delegated subagent, rendered as a Cursor-style status card: a run icon
 * (spinner → check), the task title, and a "<activity> · <model>" subtitle.
 * Clicking expands the subagent's own streamed sub-thread (reuses ChatMessage so
 * markdown / tool rows / reasoning render identically to the main thread).
 */
function SubagentCard({ child }: { child: ChildSession }) {
  const { t } = useTranslation();
  // Open while it streams; a card that's already done (reopened history) starts
  // collapsed. Initialized once so finishing mid-read never auto-folds.
  const [open, setOpen] = useState(() => !child.done);
  const messages = useAgentChatStore((s) => s.childThreads[child.id] ?? []);
  const hasOutput = messages.some((m) => m.parts.some((p) => p.text || p.tool));

  const activity = childActivity(child, messages, t);
  const subtitle = child.model ? `${activity} · ${child.model}` : activity;

  return (
    <div className="overflow-hidden rounded-lg border border-hairline-soft bg-surface-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-[10px] px-[12px] py-[9px] text-left"
      >
        {child.error ? (
          <Icon icon={AlertTriangle} size={14} className="shrink-0 text-danger" />
        ) : child.done ? (
          <Icon icon={Check} size={14} strokeWidth={2.5} className="shrink-0 text-success" />
        ) : (
          <Icon icon={Loader2} size={14} className="shrink-0 animate-spin text-muted" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-medium text-ink">
            {child.title || child.agent}
          </span>
          <span className="truncate text-caption text-muted-soft">{subtitle}</span>
        </span>
        <Icon
          icon={ChevronRight}
          size={14}
          className={cn(
            "shrink-0 text-muted-soft transition-transform duration-fast",
            open && "rotate-90",
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-hairline-soft px-[14px] py-[12px]">
          {child.error ? (
            <div className="mb-[8px] flex items-start gap-[6px] text-caption text-danger">
              <Icon icon={AlertTriangle} size={12} className="mt-[2px] shrink-0" />
              <span className="min-w-0 break-words">{child.error}</span>
            </div>
          ) : null}
          {hasOutput ? (
            <div className="flex flex-col gap-[8px]">
              {messages.map((m) => (
                <ChatMessage key={m.id} message={m} />
              ))}
            </div>
          ) : !child.error ? (
            <div className="flex items-center gap-[8px] text-caption text-muted-soft">
              <Icon icon={Loader2} size={12} className="animate-spin" />
              {t("agent.swarm.starting")}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The swarm branch: a collapsible "Started N subagents" group holding one status
 * card per delegated subagent. Renders nothing in single-agent mode (no children
 * ever register).
 */
export function SubagentGroup() {
  const { t } = useTranslation();
  const children = useAgentChatStore((s) => s.childSessions);
  const [open, setOpen] = useState(true);
  if (children.length === 0) return null;

  return (
    <div className="flex flex-col gap-[8px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-[6px] self-start text-ui text-muted hover:text-body"
      >
        <Icon
          icon={ChevronDown}
          size={14}
          className={cn("text-muted-soft transition-transform duration-fast", !open && "-rotate-90")}
        />
        {t("agent.swarm.started", { count: children.length })}
      </button>
      {open ? (
        <div className="flex flex-col gap-[8px]">
          {children.map((c) => (
            <SubagentCard key={c.id} child={c} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Best-effort "what is this subagent doing right now" from its latest tool. */
function childActivity(child: ChildSession, messages: Msg[], t: TFunction): string {
  if (child.error) return t("agent.swarm.failed");
  if (child.done) return t("agent.swarm.done");
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts;
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j];
      if (p.type !== "tool" || !p.tool?.name) continue;
      switch (p.tool.name) {
        case "edit":
        case "write":
          return t("agent.swarm.activity.editing");
        case "read":
        case "grep":
        case "glob":
        case "list":
          return t("agent.swarm.activity.exploring");
        case "bash":
          return t("agent.swarm.activity.running");
        case "webfetch":
        case "websearch":
          return t("agent.swarm.activity.searching");
        default:
          return t("agent.swarm.running");
      }
    }
  }
  // No tool yet: if it's already emitting text it's working; otherwise spinning up.
  const hasText = messages.some((m) => m.parts.some((p) => p.text));
  return t(hasText ? "agent.swarm.running" : "agent.swarm.starting");
}
