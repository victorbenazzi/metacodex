import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlarmClock, Play, Trash2 } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAgentCronStore, type CronTask } from "@/features/agent/cron.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { cn } from "@/lib/cn";
import { PanelShell } from "./PanelShell";

const DEFAULT_MODEL = "deepseek-v4-flash";

/**
 * Scheduled Tasks: create cron jobs that fire a prompt on the opencode runtime
 * every N minutes. The scheduler runs in Rust and fires while the app is open.
 */
export function ScheduledTasksPanel() {
  const { t } = useTranslation();
  const tasks = useAgentCronStore((s) => s.tasks);
  const load = useAgentCronStore((s) => s.load);
  const createTask = useAgentCronStore((s) => s.create);
  const remove = useAgentCronStore((s) => s.remove);
  const setEnabled = useAgentCronStore((s) => s.setEnabled);
  const runNow = useAgentCronStore((s) => s.runNow);
  const error = useAgentCronStore((s) => s.error);
  const agentSettings = useSettingsDataStore((s) => s.settings.agent);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [intervalMin, setIntervalMin] = useState(60);

  useEffect(() => {
    void load();
  }, [load]);

  const canSubmit = title.trim().length > 0 && prompt.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    await createTask({
      title: title.trim(),
      prompt: prompt.trim(),
      intervalMinutes: Math.max(1, Math.floor(intervalMin)),
      providerId: agentSettings.providerId || "opencode-go",
      modelId: agentSettings.modelId || DEFAULT_MODEL,
    });
    setTitle("");
    setPrompt("");
    setIntervalMin(60);
  };

  return (
    <PanelShell title={t("agent.scheduled.title")} subtitle={t("agent.scheduled.subtitle")}>
      <div className="rounded-lg border border-hairline-soft bg-surface-card p-[16px]">
        <div className="flex flex-col gap-[10px]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("agent.scheduled.titlePlaceholder")}
            className="h-[34px] rounded-sm border border-hairline-strong bg-canvas px-[10px] text-[13px] text-ink outline-none focus:border-ink"
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={t("agent.scheduled.promptPlaceholder")}
            className="resize-none rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[8px] text-[13px] leading-[1.5] text-ink outline-none focus:border-ink"
          />
          <div className="flex items-center justify-between gap-[10px]">
            <label className="flex items-center gap-[8px] text-[13px] text-body">
              {t("agent.scheduled.every")}
              <input
                type="number"
                min={1}
                value={intervalMin}
                onChange={(e) => setIntervalMin(Number(e.target.value) || 1)}
                className="h-[30px] w-[72px] rounded-sm border border-hairline-strong bg-canvas px-[8px] text-[13px] text-ink outline-none focus:border-ink"
              />
              {t("agent.scheduled.minutes")}
            </label>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="inline-flex h-[32px] items-center rounded-sm border border-ink bg-ink px-[14px] text-[13px] text-on-primary disabled:opacity-50"
            >
              {t("agent.scheduled.create")}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-[18px] flex flex-col gap-[10px]">
        {tasks.length === 0 ? (
          <EmptyState
            variant="panel"
            icon={AlarmClock}
            title={t("agent.scheduled.emptyTitle")}
            body={t("agent.scheduled.emptyBody")}
          />
        ) : (
          tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => void setEnabled(task.id, !task.enabled)}
              onRun={() => void runNow(task.id)}
              onDelete={() => void remove(task.id)}
            />
          ))
        )}
      </div>

      {error ? <p className="mt-[12px] text-[12px] text-danger">{error}</p> : null}
    </PanelShell>
  );
}

function TaskRow({
  task,
  onToggle,
  onRun,
  onDelete,
}: {
  task: CronTask;
  onToggle: () => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const meta = [t("agent.scheduled.runsEvery", { count: task.intervalMinutes })];
  if (task.lastRunAt) {
    meta.push(t("agent.scheduled.lastRun", { time: new Date(task.lastRunAt).toLocaleString() }));
  }

  return (
    <div className="flex items-center justify-between gap-[12px] rounded-lg border border-hairline-soft bg-surface-card p-[12px]">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-ink">{task.title}</div>
        <div className="mt-[2px] truncate text-[12px] text-muted">{meta.join(" · ")}</div>
      </div>
      <div className="flex shrink-0 items-center gap-[6px]">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "inline-flex h-[28px] items-center rounded-pill border border-hairline-strong px-[10px] text-[11px]",
            task.enabled ? "text-success" : "text-muted",
          )}
        >
          {task.enabled ? t("agent.scheduled.enabled") : t("agent.scheduled.disabled")}
        </button>
        <button
          type="button"
          onClick={onRun}
          aria-label={t("agent.scheduled.runNow")}
          className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-sm border border-hairline-strong text-muted hover:text-ink"
        >
          <Icon icon={Play} size={13} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("agent.scheduled.delete")}
          className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-sm border border-hairline-strong text-muted hover:text-danger"
        >
          <Icon icon={Trash2} size={13} />
        </button>
      </div>
    </div>
  );
}
