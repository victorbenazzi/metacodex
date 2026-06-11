import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { describeCron } from "@/features/agent/cron.describe";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useAgentCronStore, type CronTask } from "@/features/agent/cron.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { cn } from "@/lib/cn";
import { PanelShell } from "./PanelShell";
import { ScheduledTaskDialog } from "./ScheduledTaskDialog";

/**
 * Scheduled Tasks: create cron jobs that fire a prompt on the opencode runtime.
 * The schedule is a standard cron expression evaluated in local time by the Rust
 * scheduler while the app is open. Layout follows the Kimi reference, reskinned
 * to metacodex tokens.
 */
export function ScheduledTasksPanel() {
  const { t } = useTranslation();
  const tasks = useAgentCronStore((s) => s.tasks);
  const load = useAgentCronStore((s) => s.load);
  const remove = useAgentCronStore((s) => s.remove);
  const setEnabled = useAgentCronStore((s) => s.setEnabled);
  const runNow = useAgentCronStore((s) => s.runNow);
  const error = useAgentCronStore((s) => s.error);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTask, setEditTask] = useState<CronTask | null>(null);
  const [focusChat, setFocusChat] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CronTask | null>(null);
  // A Set: two Run now's in flight must each keep their own spinner.
  const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditTask(null);
    setFocusChat(false);
    setDialogOpen(true);
  };
  const openFromChat = () => {
    setEditTask(null);
    setFocusChat(true);
    setDialogOpen(true);
  };
  const openEdit = (task: CronTask) => {
    setEditTask(task);
    setFocusChat(false);
    setDialogOpen(true);
  };
  const handleRun = async (id: string) => {
    setRunningIds((prev) => new Set(prev).add(id));
    try {
      await runNow(id);
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <PanelShell
      title={t("agent.scheduled.title")}
      subtitle={t("agent.scheduled.subtitle")}
      action={
        <Button
          variant="primary"
          size="sm"
          onClick={openCreate}
          className="gap-[6px] rounded-pill px-[14px]"
        >
          <Icon icon={Plus} size={14} />
          {t("agent.scheduled.create")}
        </Button>
      }
    >
      {tasks.length === 0 ? (
        <div className="flex min-h-[52vh] flex-col items-center justify-center text-center">
          <span className="flex h-[64px] w-[64px] items-center justify-center rounded-xl bg-surface-strong/45">
            <Icon icon={CalendarClock} size={28} className="text-muted-soft" strokeWidth={1.5} />
          </span>
          <p className="mt-[16px] font-display text-[16px] text-body">
            {t("agent.scheduled.emptyTitle")}
          </p>
          <p className="mt-[8px] text-ui text-muted">
            <button
              type="button"
              onClick={openCreate}
              className="font-medium text-ink underline-offset-2 hover:underline"
            >
              {t("agent.scheduled.addManually")}
            </button>{" "}
            {t("agent.scheduled.or")}{" "}
            <button
              type="button"
              onClick={openFromChat}
              className="font-medium text-ink underline-offset-2 hover:underline"
            >
              {t("agent.scheduled.createFromChat")}
            </button>
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              running={runningIds.has(task.id)}
              onRun={() => void handleRun(task.id)}
              onEdit={() => openEdit(task)}
              onDelete={() => setPendingDelete(task)}
              onToggle={() => void setEnabled(task.id, !task.enabled)}
            />
          ))}
        </div>
      )}

      {error ? <p className="mt-[14px] text-caption text-danger">{error}</p> : null}

      <ScheduledTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editTask}
        focusChat={focusChat}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        tone="destructive"
        title={t("agent.scheduled.deleteTitle")}
        description={t("agent.scheduled.deleteBody", { name: pendingDelete?.title ?? "" })}
        confirmLabel={t("agent.scheduled.card.delete")}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </PanelShell>
  );
}

function TaskCard({
  task,
  running,
  onRun,
  onEdit,
  onDelete,
  onToggle,
}: {
  task: CronTask;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  const desc = describeCron(task.cron, i18n.language);
  const scheduleLabel = desc.valid ? desc.text : task.cron;
  const isError = task.lastStatus?.startsWith("error") ?? false;

  // The last run's transcript is one click away (that session IS the output of
  // a headless run); the full error detail rides the hover title.
  const openLastRun = async () => {
    if (!task.lastSessionId) return;
    useAgentNavStore.getState().setSection("chat");
    await useAgentChatStore.getState().setDirectory(task.directory ?? null);
    await useAgentChatStore.getState().selectSession(task.lastSessionId);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-[12px] rounded-lg border border-hairline-soft bg-surface-card p-[14px]",
        !task.enabled && "opacity-70",
      )}
    >
      <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-md bg-surface-strong/45">
        <Icon icon={CalendarClock} size={17} className="text-muted" strokeWidth={1.75} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[8px]">
          <span className="truncate text-ui font-medium text-ink">{task.title}</span>
          {!task.enabled ? (
            <span className="shrink-0 rounded-pill bg-surface-strong/60 px-[7px] py-[1px] text-[10px] font-medium text-muted">
              {t("agent.scheduled.card.off")}
            </span>
          ) : null}
        </div>
        <div className="mt-[2px] truncate text-caption text-muted">{scheduleLabel}</div>
        <div className="mt-[4px] flex items-center gap-[8px] overflow-hidden text-label text-muted-soft">
          <span className="shrink-0 rounded-sm bg-surface-strong/40 px-[5px] py-[1px] font-mono tracking-[0.02em]">
            {task.cron}
          </span>
          {task.enabled && task.nextRunAt ? (
            <span className="truncate">{t("agent.scheduled.card.next", { time: fmtTime(task.nextRunAt, i18n.language) })}</span>
          ) : null}
          {task.lastRunAt ? (
            <button
              type="button"
              onClick={() => void openLastRun()}
              disabled={!task.lastSessionId}
              title={isError ? (task.lastStatus ?? undefined) : t("agent.scheduled.card.openRun")}
              className={cn(
                "inline-flex shrink-0 items-center gap-[5px]",
                task.lastSessionId && "hover:text-ink hover:underline underline-offset-2",
              )}
            >
              <span
                aria-hidden
                className={cn("h-[6px] w-[6px] rounded-pill", isError ? "bg-danger" : "bg-success")}
              />
              {isError
                ? t("agent.scheduled.card.lastError")
                : t("agent.scheduled.card.lastOk", { time: fmtTime(task.lastRunAt, i18n.language) })}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-[4px]">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "h-[28px] rounded-pill border px-[11px] text-label font-medium transition-colors duration-fast",
            task.enabled
              ? "border-success/40 text-success hover:bg-success/10"
              : "border-hairline-strong text-muted hover:bg-surface-strong/45",
          )}
        >
          {task.enabled ? t("agent.scheduled.card.on") : t("agent.scheduled.card.off")}
        </button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRun}
          disabled={running}
          aria-label={t("agent.scheduled.card.runNow")}
          title={t("agent.scheduled.card.runNow")}
        >
          <Icon icon={running ? Loader2 : Play} size={14} className={cn(running && "animate-spin")} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label={t("agent.scheduled.card.edit")}
          title={t("agent.scheduled.card.edit")}
        >
          <Icon icon={Pencil} size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          aria-label={t("agent.scheduled.card.delete")}
          title={t("agent.scheduled.card.delete")}
          className="hover:text-danger"
        >
          <Icon icon={Trash2} size={14} />
        </Button>
      </div>
    </div>
  );
}

function fmtTime(ms: number, language: string): string {
  try {
    return new Date(ms).toLocaleString(language, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ms).toLocaleString();
  }
}
