import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { describeCron } from "@/features/agent/cron.describe";
import { extractScheduledTask } from "@/features/agent/cron.fromText";
import { DEFAULT_MODEL, useAgentChatStore } from "@/features/agent/chat.store";
import { useAgentCronStore, type CronTask } from "@/features/agent/cron.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { cn } from "@/lib/cn";
import { CronField } from "./CronField";

const NAME_MAX = 50;
const DEFAULT_CRON = "0 9 * * *";

/**
 * Create / edit a scheduled task. Layout follows the Kimi reference (Name +
 * counter, Requirement, schedule) but the schedule is a real cron expression
 * instead of calendar dropdowns, so it stays portable to an external scheduler.
 */
export function ScheduledTaskDialog({
  open,
  onOpenChange,
  task,
  focusChat = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit mode; absent = create mode. */
  task?: CronTask | null;
  /** Open with the natural-language "from chat" box focused (create mode only). */
  focusChat?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const createTask = useAgentCronStore((s) => s.create);
  const updateTask = useAgentCronStore((s) => s.update);

  const agent = useSettingsDataStore((s) => s.settings.agent);
  const chatDirectory = useAgentChatStore((s) => s.directory);
  const activeProject = useProjectsStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );

  const isEdit = task != null;
  // The project the task runs in (and that the NL extractor reads for context).
  // EDIT MODE keeps the task's stored target: renaming a task must never
  // silently retarget an unattended full-auto run at whatever project the chat
  // happens to be scoped to right now.
  const directory = isEdit ? (task?.directory ?? null) : (chatDirectory ?? activeProject?.path ?? null);

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cron, setCron] = useState(DEFAULT_CRON);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Natural-language assist ("Create from chat").
  const [nl, setNl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);

  // Seed the form whenever the dialog opens (or the edited task changes).
  useEffect(() => {
    if (!open) return;
    setName(task?.title ?? "");
    setPrompt(task?.prompt ?? "");
    setCron(task?.cron ?? DEFAULT_CRON);
    setSubmitError(null);
    setNl("");
    setNlError(null);
    setGenerating(false);
  }, [open, task]);

  const generate = async () => {
    const request = nl.trim();
    if (!request || generating) return;
    setGenerating(true);
    setNlError(null);
    const result = await extractScheduledTask(request, directory);
    setGenerating(false);
    if (result.ok) {
      if (result.title) setName(result.title);
      if (result.prompt) setPrompt(result.prompt);
      if (result.cron) setCron(result.cron);
    } else {
      setNlError(t("agent.scheduled.dialog.generateError"));
    }
  };

  const cronValid = describeCron(cron, i18n.language).valid;
  const canSubmit = name.trim().length > 0 && prompt.trim().length > 0 && cronValid;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const input = {
      title: name.trim().slice(0, NAME_MAX),
      prompt: prompt.trim(),
      cron: cron.trim(),
      directory,
      // Same rule as directory: editing keeps the task's stored model.
      providerId: isEdit ? task!.providerId : agent.providerId || "opencode-go",
      modelId: isEdit ? task!.modelId : agent.modelId || DEFAULT_MODEL,
    };
    const res = task
      ? await updateTask(task.id, input)
      : await createTask(input);
    setSubmitting(false);
    if (res.ok) {
      onOpenChange(false);
    } else {
      setSubmitError(res.error);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width={560}
        title={task ? t("agent.scheduled.dialog.editTitle") : t("agent.scheduled.dialog.newTitle")}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t("agent.scheduled.dialog.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={!canSubmit || submitting}>
              {t("agent.scheduled.dialog.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[18px]">
          {!isEdit ? (
            <div className="rounded-lg border border-hairline-strong bg-surface-1 p-[12px]">
              <div className="mb-[8px] flex items-center gap-[6px] text-[12px] font-medium text-body">
                <Icon icon={Sparkles} size={13} className="text-muted" />
                {t("agent.scheduled.dialog.fromChatTitle")}
              </div>
              <textarea
                value={nl}
                onChange={(e) => setNl(e.target.value)}
                rows={2}
                autoFocus={focusChat}
                placeholder={t("agent.scheduled.dialog.fromChatPlaceholder")}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void generate();
                  }
                }}
                className="w-full resize-none rounded-md border border-hairline-soft bg-canvas px-[10px] py-[8px] text-[13px] leading-[1.5] text-ink outline-none transition-colors duration-150 focus:border-ink"
              />
              <div className="mt-[8px] flex items-center justify-between gap-[10px]">
                <span
                  className={cn(
                    "text-[11.5px] leading-[1.4]",
                    nlError ? "text-danger" : "text-muted-soft",
                  )}
                >
                  {nlError ?? t("agent.scheduled.dialog.fromChatHint")}
                </span>
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => void generate()}
                  disabled={!nl.trim() || generating}
                  className="shrink-0 gap-[6px]"
                >
                  <Icon
                    icon={generating ? Loader2 : Sparkles}
                    size={13}
                    className={cn(generating && "animate-spin")}
                  />
                  {t("agent.scheduled.dialog.generate")}
                </Button>
              </div>
            </div>
          ) : null}

          <Field label={t("agent.scheduled.dialog.name")} required>
            <div className="relative">
              <input
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("agent.scheduled.dialog.namePlaceholder")}
                autoFocus={!focusChat}
                className="h-[38px] w-full rounded-md border border-hairline-strong bg-surface-1 pl-[12px] pr-[52px] text-[13px] text-ink outline-none transition-colors duration-150 focus:border-ink"
              />
              <span className="pointer-events-none absolute right-[12px] top-1/2 -translate-y-1/2 font-mono text-[11px] tabular-nums text-muted-soft">
                {name.length}/{NAME_MAX}
              </span>
            </div>
          </Field>

          <Field label={t("agent.scheduled.dialog.requirement")} required>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={t("agent.scheduled.dialog.requirementPlaceholder")}
              className="w-full resize-none rounded-md border border-hairline-strong bg-surface-1 px-[12px] py-[10px] text-[13px] leading-[1.55] text-ink outline-none transition-colors duration-150 focus:border-ink"
            />
          </Field>

          {/* Not a <label>: CronField contains its own buttons + input, which
              must not be implicitly associated with a wrapping label. */}
          <div className="flex flex-col gap-[8px]">
            <span className="text-[12px] font-medium text-body">
              {t("agent.scheduled.dialog.schedule")}
              <span className="ml-[3px] text-danger">*</span>
            </span>
            <CronField value={cron} onChange={setCron} />
          </div>

          {/* Where the unattended run executes; surfaced so an edit can never
              silently point elsewhere. */}
          <p className="text-[11.5px] leading-[1.5] text-muted-soft">
            {t("agent.scheduled.dialog.runsIn")}{" "}
            <span className="font-mono text-muted">
              {directory ?? t("agent.project.noFolder")}
            </span>
          </p>

          {submitError ? (
            <p className="text-[12px] leading-[1.5] text-danger">
              {t("agent.scheduled.dialog.saveFailed")} {submitError}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[8px]">
      <span className={cn("text-[12px] font-medium text-body")}>
        {label}
        {required ? <span className="ml-[3px] text-danger">*</span> : null}
      </span>
      {children}
    </label>
  );
}
