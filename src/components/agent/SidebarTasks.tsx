import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { describeCron } from "@/features/agent/cron.describe";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useAgentCronStore, type CronRun, type CronTask } from "@/features/agent/cron.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { cn } from "@/lib/cn";

/**
 * Sidebar "Tasks" section: scheduled tasks grouped by task, each expandable to its
 * run history. A run opens its opencode session as a chat thread in the main area
 * (Kimi-style), which is the only place a headless scheduled run's output surfaces.
 * Polls so new runs appear without reopening the view.
 */
export function SidebarTasks() {
  const { t, i18n } = useTranslation();
  const tasks = useAgentCronStore((s) => s.tasks);
  const load = useAgentCronStore((s) => s.load);
  const setSection = useAgentNavStore((s) => s.setSection);
  const setDirectory = useAgentChatStore((s) => s.setDirectory);
  const selectSession = useAgentChatStore((s) => s.selectSession);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openRun = async (task: CronTask, run: CronRun) => {
    if (!run.sessionId) return;
    setSection("chat");
    await setDirectory(task.directory ?? null);
    await selectSession(run.sessionId);
  };

  if (tasks.length === 0) {
    return (
      <p className="px-[10px] py-[4px] text-caption leading-[1.5] text-muted">
        {t("agent.sidebar.tasksEmpty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-[1px]">
      {tasks.map((task) => {
        const isOpen = expanded.has(task.id);
        const runs = task.runs ?? [];
        const schedule = describeCron(task.cron, i18n.language);
        return (
          <div key={task.id}>
            <button
              type="button"
              onClick={() => toggle(task.id)}
              title={schedule.valid ? schedule.text : task.cron}
              className="group flex w-full items-center gap-[7px] rounded-md px-[10px] py-[6px] text-left transition-colors duration-fast hover:bg-surface-1"
            >
              <Icon
                icon={isOpen ? ChevronDown : ChevronRight}
                size={13}
                className="shrink-0 text-muted-soft"
              />
              <span className="flex-1 truncate text-ui text-body">{task.title}</span>
              {!task.enabled ? (
                <span className="shrink-0 text-[10px] text-muted-soft">
                  {t("agent.scheduled.card.off")}
                </span>
              ) : runs.length > 0 ? (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-soft">
                  {runs.length}
                </span>
              ) : null}
            </button>

            {isOpen ? (
              <div className="ml-[21px] mb-[2px] flex flex-col gap-[1px] border-l border-hairline-soft pl-[8px]">
                {runs.length === 0 ? (
                  <p className="px-[8px] py-[3px] text-label text-muted-soft">
                    {t("agent.sidebar.noRuns")}
                  </p>
                ) : (
                  runs.map((run, i) => {
                    const isError = run.status.startsWith("error");
                    return (
                      <button
                        // Rust inserts new runs at the FRONT; an index key would
                        // shift every row's identity on each new run.
                        key={`${run.ranAt}-${run.sessionId ?? i}`}
                        type="button"
                        onClick={() => void openRun(task, run)}
                        disabled={!run.sessionId}
                        title={isError ? run.status : undefined}
                        className={cn(
                          "flex items-center gap-[7px] rounded-sm px-[8px] py-[3px] text-left text-label transition-colors duration-fast",
                          run.sessionId
                            ? "text-muted hover:bg-surface-1 hover:text-ink"
                            : "cursor-default text-muted-soft",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "h-[5px] w-[5px] shrink-0 rounded-pill",
                            isError ? "bg-danger" : "bg-success",
                          )}
                        />
                        <span className="truncate tabular-nums">{fmtRun(run.ranAt, i18n.language)}</span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function fmtRun(ms: number, language: string): string {
  try {
    return new Date(ms).toLocaleString(language, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ms).toLocaleString();
  }
}
