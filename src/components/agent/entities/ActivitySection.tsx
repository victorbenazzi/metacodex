import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { useAgentChatStore } from "@/features/agent/chat.store";
import {
  entityLifeApi,
  type AgentActivity,
  type AgentEntity,
  type RunLogEntry,
} from "@/features/agent/entities.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { cn } from "@/lib/cn";

function ts(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleString() : "";
}

/** Normalized status of a run/report line: i18n key suffix + optional raw
 *  detail (the part after "error:" rides along untranslated). */
function statusParts(status: string): { key: string; detail?: string } {
  if (status === "ok") return { key: "ok" };
  if (status === "ok-quiet") return { key: "ok-quiet" };
  if (status === "aborted") return { key: "aborted" };
  if (status === "needs-you (pending)") return { key: "pending" };
  if (status.startsWith("needs-you")) return { key: "needs-you" };
  if (status.startsWith("incomplete")) return { key: "incomplete" };
  if (status.startsWith("error")) {
    const detail = status.slice("error".length).replace(/^:\s*/, "").trim();
    return { key: "error", ...(detail ? { detail } : {}) };
  }
  return { key: status };
}

function statusTone(status: string): string {
  if (status.startsWith("ok")) return "text-muted";
  if (status.startsWith("needs-you")) return "text-warn";
  if (status.startsWith("incomplete")) return "text-warn";
  return "text-danger";
}

/** Translated status label; falls back to the raw status for unknown values. */
function StatusLabel({ status }: { status: string }) {
  const { t } = useTranslation();
  const { key, detail } = statusParts(status);
  const label = t(`agent.agents.activity.status.${key}`, key);
  return (
    <>
      {label}
      {detail ? <span className="text-muted-soft"> · {detail}</span> : null}
    </>
  );
}

/** Jump to the run's conversation: rebind the chat directory (heartbeat/dream
 *  runs live in the agent's home, which no project section shows), open the
 *  session, then navigate the sidebar to the chat. This is the path to approve
 *  a permission a headless run left pending. */
function openRunConversation(run: RunLogEntry): void {
  const sessionId = run.sessionId;
  if (!sessionId) return;
  void (async () => {
    const chat = useAgentChatStore.getState();
    const dir = run.directory ?? null;
    if (dir !== chat.directory) await chat.setDirectory(dir);
    await useAgentChatStore.getState().selectSession(sessionId);
    useAgentNavStore.getState().setSection("chat");
  })();
}

/** Activity tab of an agent profile: reports + the autonomous run log. */
export function ActivitySection({ entity }: { entity: AgentEntity }) {
  const { t } = useTranslation();
  const [activity, setActivity] = useState<AgentActivity | null>(null);
  const [openReport, setOpenReport] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setActivity(null);
    void entityLifeApi
      .activity(entity.id)
      .then((next) => {
        if (!cancelled) setActivity(next);
      })
      .catch(() => {
        if (!cancelled) setActivity({ reports: [], runs: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [entity.id]);

  if (!activity) {
    return <p className="text-caption text-muted">{t("agent.agents.activity.loading")}</p>;
  }
  if (activity.reports.length === 0 && activity.runs.length === 0) {
    return (
      <EmptyState
        variant="panel"
        title={t("agent.agents.activity.emptyTitle")}
        body={t("agent.agents.activity.emptyBody")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[20px]">
      <section>
        <h3 className="mb-[8px] text-caption font-medium text-body">
          {t("agent.agents.activity.reports")}
        </h3>
        {activity.reports.length === 0 ? (
          <p className="text-caption text-muted-soft">{t("agent.agents.activity.noReports")}</p>
        ) : (
          <ul className="flex flex-col gap-[6px]">
            {activity.reports.map((r) => (
              <li key={r.file} className="rounded-lg border border-hairline bg-surface-card">
                <button
                  type="button"
                  onClick={() => setOpenReport(openReport === r.file ? null : r.file)}
                  className={cn(
                    "flex w-full items-center gap-[10px] rounded-lg px-[12px] py-[9px] text-left transition-colors duration-fast",
                    "hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
                    openReport === r.file && "rounded-b-none",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-ui text-ink">{r.title}</span>
                  <span className="shrink-0 text-label uppercase tracking-label text-muted-soft">
                    {r.trigger}
                  </span>
                  <span className={cn("shrink-0 text-label", statusTone(r.status))}>
                    <StatusLabel status={r.status} />
                  </span>
                  <span className="shrink-0 text-label text-muted-soft">{ts(r.createdAt)}</span>
                </button>
                {openReport === r.file ? (
                  <pre className="whitespace-pre-wrap border-t border-hairline-soft px-[12px] py-[10px] font-mono text-caption leading-[1.6] text-body">
                    {r.content.trim()}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-[8px] text-caption font-medium text-body">
          {t("agent.agents.activity.runs")}
        </h3>
        <ul className="flex flex-col gap-[2px]">
          {activity.runs.map((run, i) => (
            <li
              key={`${run.startedAt}-${i}`}
              className="flex items-center gap-[10px] rounded-sm px-[8px] py-[4px] text-caption"
            >
              <span className="w-[88px] shrink-0 uppercase tracking-label text-label text-muted-soft">
                {run.trigger}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", statusTone(run.status))}>
                <StatusLabel status={run.status} />
                {run.continuations > 0
                  ? ` · ${t("agent.agents.activity.continuations", { count: run.continuations })}`
                  : ""}
              </span>
              {run.sessionId ? (
                <IconButton
                  size="sm"
                  aria-label={t("agent.agents.activity.openConversation")}
                  title={t("agent.agents.activity.openConversation")}
                  onClick={() => openRunConversation(run)}
                >
                  <Icon icon={MessageSquare} size={12} />
                </IconButton>
              ) : null}
              <span className="shrink-0 text-label text-muted-soft">{ts(run.startedAt)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
