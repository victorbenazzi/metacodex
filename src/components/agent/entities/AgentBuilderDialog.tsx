import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { useAgentChatStore } from "@/features/agent/chat.store";
import {
  useAgentEntitiesStore,
  type AgentAvatarInput,
  type AgentEntity,
  type AgentEntityInput,
} from "@/features/agent/entities.store";
import { extractAgentDraft } from "@/features/agent/entities.fromText";
import { useAgentRuntimeStore } from "@/features/agent/runtime.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { isModelEnabled } from "@/features/settings/settings.types";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { cn } from "@/lib/cn";
import { AgentAvatarBadge } from "./AgentAvatar";

const NAME_MAX = 40;
const MAX_AVATAR_BYTES = 1024 * 1024;
const PRESETS = ["ask", "auto-edit", "full-auto"] as const;

/** Form-local avatar state; materialized into `AgentAvatarInput` on submit. */
type AvatarDraft =
  | { kind: "none" }
  | { kind: "emoji"; value: string }
  /** `stored` = came from the entity unchanged (edit), submit sends "keep". */
  | { kind: "image"; dataUrl: string; stored: boolean };

function toAvatarInput(draft: AvatarDraft): AgentAvatarInput | undefined {
  if (draft.kind === "emoji" && draft.value.trim()) {
    return { kind: "emoji", value: draft.value.trim() };
  }
  if (draft.kind === "image") {
    return draft.stored ? { kind: "keep" } : { kind: "image", dataUrl: draft.dataUrl };
  }
  return undefined;
}

/**
 * Create / edit an agent entity. Same anatomy as the Scheduled Task dialog:
 * an optional natural-language box on create ("describe the agent you want",
 * one-shot prefill, never auto-saved) above the real form.
 */
export function AgentBuilderDialog({
  open,
  onOpenChange,
  entity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit mode; absent = create mode. */
  entity?: AgentEntity | null;
}) {
  const { t } = useTranslation();
  const createEntity = useAgentEntitiesStore((s) => s.create);
  const updateEntity = useAgentEntitiesStore((s) => s.update);
  const providers = useAgentRuntimeStore((s) => s.providers);
  const enabledModels = useSettingsDataStore((s) => s.settings.agent.enabledModels);
  const projects = useProjectsStore((s) => s.projects);
  const directory = useAgentChatStore((s) => s.directory);

  const isEdit = entity != null;

  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [avatar, setAvatar] = useState<AvatarDraft>({ kind: "none" });
  const [model, setModel] = useState(""); // "providerId/modelId" or "" = inherit
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>("ask");
  const [allProjects, setAllProjects] = useState(true);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Natural-language assist ("describe the agent you want").
  const [nl, setNl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // Seed the form whenever the dialog opens (or the edited entity changes).
  useEffect(() => {
    if (!open) return;
    setName(entity?.name ?? "");
    setPersona(entity?.persona ?? "");
    setAvatar(
      entity?.avatar?.kind === "image"
        ? { kind: "image", dataUrl: entity.avatar.value, stored: true }
        : entity?.avatar?.kind === "emoji"
          ? { kind: "emoji", value: entity.avatar.value }
          : { kind: "none" },
    );
    setModel(entity?.providerId && entity?.modelId ? `${entity.providerId}/${entity.modelId}` : "");
    setPreset(entity?.permissionPreset ?? "ask");
    setAllProjects(!entity?.projects);
    setProjectIds(entity?.projects ?? []);
    setSubmitting(false);
    setSubmitError(null);
    setNl("");
    setNlError(null);
    setGenerating(false);
  }, [open, entity]);

  const generate = async () => {
    const request = nl.trim();
    if (!request || generating) return;
    setGenerating(true);
    setNlError(null);
    const result = await extractAgentDraft(request, directory);
    setGenerating(false);
    if (result.ok) {
      if (result.name) setName(result.name.slice(0, NAME_MAX));
      if (result.persona) setPersona(result.persona);
      if (result.emoji) setAvatar({ kind: "emoji", value: result.emoji });
    } else {
      setNlError(t("agent.agents.builder.generateError"));
    }
  };

  const pickImage = (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setSubmitError(t("agent.agents.builder.avatarTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatar({ kind: "image", dataUrl: reader.result, stored: false });
        setSubmitError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const canSubmit =
    name.trim().length > 0 && persona.trim().length > 0 && (allProjects || projectIds.length > 0);

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const [providerId, modelId] = model ? model.split("/", 2) : ["", ""];
    const input: AgentEntityInput = {
      name: name.trim().slice(0, NAME_MAX),
      persona: persona.trim(),
      avatar: toAvatarInput(avatar),
      ...(providerId && modelId ? { providerId, modelId } : {}),
      permissionPreset: preset,
      ...(allProjects ? {} : { projects: projectIds }),
    };
    const res = entity
      ? await updateEntity(entity.id, input)
      : await createEntity(input);
    setSubmitting(false);
    if (res) {
      onOpenChange(false);
    } else {
      setSubmitError(useAgentEntitiesStore.getState().error);
    }
  };

  // Model options: catalog grouped flat, filtered by the composer's visibility
  // rule, with an "inherit" first entry (the entity rides the user's pick).
  // Radix Select forbids an empty item value, so "inherit" is the sentinel.
  const modelOptions = [
    { value: "inherit", label: t("agent.agents.builder.modelInherit") },
    ...providers.flatMap((p) =>
      p.models
        .filter((m) => isModelEnabled(enabledModels, p.id, m.id))
        .map((m) => ({ value: `${p.id}/${m.id}`, label: `${p.name} · ${m.name}` })),
    ),
  ];

  const presetOptions = PRESETS.map((p) => ({
    value: p,
    label: t(`agent.permission.${p}`),
  }));

  const previewAvatar =
    avatar.kind === "image"
      ? ({ kind: "image", value: avatar.dataUrl } as const)
      : avatar.kind === "emoji" && avatar.value.trim()
        ? ({ kind: "emoji", value: avatar.value.trim() } as const)
        : undefined;

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width={620}
        title={isEdit ? t("agent.agents.builder.editTitle") : t("agent.agents.builder.newTitle")}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t("agent.agents.builder.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={!canSubmit || submitting}>
              {t("agent.agents.builder.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[18px]">
          {!isEdit ? (
            <div className="rounded-lg border border-hairline-strong bg-surface-1 p-[12px]">
              <div className="mb-[8px] flex items-center gap-[6px] text-caption font-medium text-body">
                <Icon icon={Sparkles} size={13} className="text-muted" />
                {t("agent.agents.builder.describeTitle")}
              </div>
              <textarea
                value={nl}
                onChange={(e) => setNl(e.target.value)}
                rows={2}
                placeholder={t("agent.agents.builder.describePlaceholder")}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void generate();
                  }
                }}
                className="w-full resize-none rounded-md border border-hairline-soft bg-canvas px-[10px] py-[8px] text-ui leading-[1.5] text-ink outline-none transition-colors duration-fast focus:border-ink"
              />
              <div className="mt-[8px] flex items-center justify-between gap-[10px]">
                <span className={cn("text-label leading-[1.4]", nlError ? "text-danger" : "text-muted-soft")}>
                  {nlError ?? t("agent.agents.builder.describeHint")}
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
                  {t("agent.agents.builder.generate")}
                </Button>
              </div>
            </div>
          ) : null}

          {/* Identity row: avatar (emoji or photo) + name. */}
          <div className="flex items-start gap-[14px]">
            <div className="flex flex-col items-center gap-[6px]">
              <AgentAvatarBadge avatar={previewAvatar} size="lg" />
              <div className="flex items-center gap-[2px]">
                <button
                  type="button"
                  title={t("agent.agents.builder.avatarUpload")}
                  aria-label={t("agent.agents.builder.avatarUpload")}
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-strong/55 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
                >
                  <Icon icon={ImagePlus} size={13} />
                </button>
                {avatar.kind !== "none" ? (
                  <button
                    type="button"
                    title={t("agent.agents.builder.avatarRemove")}
                    aria-label={t("agent.agents.builder.avatarRemove")}
                    onClick={() => setAvatar({ kind: "none" })}
                    className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-strong/55 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
                  >
                    <Icon icon={X} size={13} />
                  </button>
                ) : null}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  pickImage(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-[12px]">
              <Field label={t("agent.agents.builder.name")} required>
                <div className="relative">
                  <input
                    value={name}
                    maxLength={NAME_MAX}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("agent.agents.builder.namePlaceholder")}
                    className="h-[38px] w-full rounded-md border border-hairline-strong bg-surface-1 pl-[12px] pr-[52px] text-ui text-ink outline-none transition-colors duration-fast focus:border-ink"
                  />
                  <span className="pointer-events-none absolute right-[12px] top-1/2 -translate-y-1/2 font-mono text-label tabular-nums text-muted-soft">
                    {name.length}/{NAME_MAX}
                  </span>
                </div>
              </Field>
              <Field label={t("agent.agents.builder.avatarEmoji")}>
                <input
                  value={avatar.kind === "emoji" ? avatar.value : ""}
                  maxLength={4}
                  onChange={(e) =>
                    setAvatar(
                      e.target.value.trim()
                        ? { kind: "emoji", value: e.target.value }
                        : { kind: "none" },
                    )
                  }
                  placeholder="🤖"
                  className="h-[34px] w-[88px] rounded-md border border-hairline-strong bg-surface-1 px-[12px] text-center text-title text-ink outline-none transition-colors duration-fast focus:border-ink"
                />
              </Field>
            </div>
          </div>

          <Field label={t("agent.agents.builder.persona")} required>
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              rows={6}
              placeholder={t("agent.agents.builder.personaPlaceholder")}
              className="w-full resize-none rounded-md border border-hairline-strong bg-surface-1 px-[12px] py-[10px] font-mono text-caption leading-[1.55] text-ink outline-none transition-colors duration-fast focus:border-ink"
            />
            <span className="text-label leading-[1.4] text-muted-soft">
              {t("agent.agents.builder.personaHint")}
            </span>
          </Field>

          <div className="grid grid-cols-2 gap-[14px]">
            <Field label={t("agent.agents.builder.model")}>
              <Select
                value={model || "inherit"}
                onValueChange={(v) => setModel(v === "inherit" ? "" : v)}
                options={modelOptions}
                ariaLabel={t("agent.agents.builder.model")}
                className="w-full"
              />
            </Field>
            <Field label={t("agent.agents.builder.permission")}>
              <Select
                value={preset}
                onValueChange={(v) => setPreset(v as (typeof PRESETS)[number])}
                options={presetOptions}
                ariaLabel={t("agent.agents.builder.permission")}
                className="w-full"
              />
            </Field>
          </div>

          {/* Projects the agent may work in (the autonomy boundary later). */}
          <div className="flex flex-col gap-[8px]">
            <span className="text-caption font-medium text-body">
              {t("agent.agents.builder.projects")}
            </span>
            <label className="flex cursor-pointer items-center gap-[8px] text-ui text-body">
              <input
                type="checkbox"
                checked={allProjects}
                onChange={(e) => setAllProjects(e.target.checked)}
                className="accent-current"
              />
              {t("agent.agents.builder.projectsAll")}
            </label>
            {!allProjects ? (
              <div className="flex max-h-[140px] flex-col gap-[2px] overflow-y-auto rounded-md border border-hairline-soft p-[8px]">
                {projects.length === 0 ? (
                  <span className="px-[4px] py-[2px] text-caption text-muted-soft">
                    {t("agent.agents.builder.projectsEmpty")}
                  </span>
                ) : (
                  projects.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-[8px] rounded-sm px-[6px] py-[4px] text-ui text-body hover:bg-surface-1"
                    >
                      <input
                        type="checkbox"
                        checked={projectIds.includes(p.id)}
                        onChange={(e) =>
                          setProjectIds((ids) =>
                            e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id),
                          )
                        }
                        className="accent-current"
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  ))
                )}
              </div>
            ) : null}
          </div>

          {submitError ? (
            <p className="text-caption leading-[1.5] text-danger">
              {t("agent.agents.builder.saveFailed")} {submitError}
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
    <label className="flex flex-col gap-[6px]">
      <span className="text-caption font-medium text-body">
        {label}
        {required ? <span className="ml-[3px] text-danger">*</span> : null}
      </span>
      {children}
    </label>
  );
}
