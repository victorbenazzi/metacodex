import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Circle, CircleDashed, X } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useAgentChatStore } from "@/features/agent/chat.store";

/**
 * The agent's live plan (opencode todo list, fed by `todo.updated` and seeded
 * from `GET /session/{id}/todo` on open). Collapsed it reads "Plan · 3/7";
 * expanded it shows every step with its status. Renders nothing while the
 * session has no plan.
 */
export function TodoCard() {
  const { t } = useTranslation();
  const sessionId = useAgentChatStore((s) => s.sessionId);
  const todos = useAgentChatStore((s) => (s.sessionId ? s.todosBySession[s.sessionId] : undefined));
  const [open, setOpen] = useState(true);

  if (!sessionId || !todos || todos.length === 0) return null;

  const done = todos.filter((td) => td.status === "completed").length;

  return (
    <div className="self-stretch rounded-lg border border-hairline-soft bg-surface-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-[8px] px-[12px] py-[8px] text-left"
      >
        <Icon
          icon={ChevronRight}
          size={13}
          className={cn("shrink-0 text-muted-soft transition-transform duration-150", open && "rotate-90")}
        />
        <span className="text-[12.5px] font-medium text-ink">{t("agent.todo.title")}</span>
        <span className="text-[12px] text-muted-soft">
          {done}/{todos.length}
        </span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-[4px] px-[14px] pb-[10px]">
          {todos.map((td, i) => (
            <li key={`${i}-${td.content.slice(0, 24)}`} className="flex items-start gap-[8px] text-[12.5px]">
              <TodoIcon status={td.status} />
              <span
                className={cn(
                  "min-w-0 break-words leading-[1.5]",
                  td.status === "completed" && "text-muted-soft line-through",
                  td.status === "cancelled" && "text-muted-soft line-through",
                  td.status === "in_progress" && "text-ink",
                  td.status === "pending" && "text-body",
                )}
              >
                {td.content}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TodoIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <Icon icon={Check} size={13} strokeWidth={2.5} className="mt-[2px] shrink-0 text-success" />;
    case "in_progress":
      return <Icon icon={CircleDashed} size={13} className="mt-[2px] shrink-0 animate-pulse text-warn" />;
    case "cancelled":
      return <Icon icon={X} size={13} className="mt-[2px] shrink-0 text-muted-soft" />;
    default:
      return <Icon icon={Circle} size={13} className="mt-[2px] shrink-0 text-muted-soft" />;
  }
}
