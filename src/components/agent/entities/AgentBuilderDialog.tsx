import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Loader2, Pencil, Sparkles, SquarePen, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { useAnchoredPopup } from "@/components/ui/useAnchoredPopup";
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
import { firstGrapheme } from "@/lib/grapheme";
import { AgentAvatarBadge } from "./AgentAvatar";

const NAME_MAX = 40;
const MAX_AVATAR_BYTES = 1024 * 1024;
/** Raw input cap for the emoji field: legit ZWJ sequences span several code
 *  units; materialization cuts to the first grapheme anyway. */
const EMOJI_INPUT_MAX = 8;
const AVATAR_MAX_DIM = 128;
const PRESETS = ["ask", "auto-edit", "full-auto"] as const;

type BuilderMode = "describe" | "manual";

/** Curated picks for the avatar popover; any other emoji can be typed in the
 *  free input below the grid. */
const EMOJI_CHOICES = [
  "🤖", "🧠", "🦾", "🛠️", "🔍", "🧪", "📝", "📚",
  "🐞", "🚀", "🧹", "🔒", "🛡️", "🌐", "💬", "📊",
  "🎨", "⚙️", "🧭", "🎯", "⚡️", "🔥", "🦉", "🦊",
] as const;

/** Form-local avatar state; materialized into `AgentAvatarInput` on submit. */
type AvatarDraft =
  | { kind: "none" }
  | { kind: "emoji"; value: string }
  /** `stored` = came from the entity unchanged (edit), submit sends "keep". */
  | { kind: "image"; dataUrl: string; stored: boolean };

function toAvatarInput(draft: AvatarDraft): AgentAvatarInput | undefined {
  if (draft.kind === "emoji" && draft.value.trim()) {
    // First grapheme cluster, not a code-unit slice: family/flag/skin-tone
    // emoji are multi-code-point and a blind cut renders tofu.
    const emoji = firstGrapheme(draft.value);
    return emoji ? { kind: "emoji", value: emoji } : undefined;
  }
  if (draft.kind === "image") {
    return draft.stored ? { kind: "keep" } : { kind: "image", dataUrl: draft.dataUrl };
  }
  return undefined;
}

/** Downscale an avatar data URL to fit 128x128 (aspect preserved) via canvas.
 *  Returns the original URL when already small enough or on any failure: the
 *  1 MB pick gate already bounds the worst case. */
function downscaleAvatar(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w <= AVATAR_MAX_DIM && h <= AVATAR_MAX_DIM) {
        resolve(dataUrl);
        return;
      }
      const scale = AVATAR_MAX_DIM / Math.max(w, h);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Avatar control: one clickable identity badge that opens a popover grouping
 * EVERY avatar affordance (curated emoji grid, free emoji input, photo upload,
 * remove). Hand-rolled panel, not a Radix menu: the free input needs real
 * focus (same reasoning as MentionPopup). Pure-opacity fade per the popup
 * motion rule.
 */
function AvatarPicker({
  draft,
  preview,
  onEmoji,
  onRemove,
  onUpload,
}: {
  draft: AvatarDraft;
  preview: { kind: "emoji" | "image"; value: string } | undefined;
  onEmoji: (value: string) => void;
  onRemove: () => void;
  onUpload: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Collision-aware placement: flips above the trigger / shifts inward near a
  // viewport edge instead of the old static `top-full left-0`. Absolute
  // strategy (no portal) keeps the panel inside rootRef, so the click-outside
  // check below still covers it.
  const { refs, floatingStyles } = useAnchoredPopup({
    open,
    placement: "bottom-start",
    constrainHeight: false,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={refs.setReference}
        type="button"
        aria-label={t("agent.agents.builder.avatarLabel")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group relative block rounded-pill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
      >
        <AgentAvatarBadge avatar={preview} size="lg" />
        <span
          aria-hidden
          className="absolute -bottom-[2px] -right-[2px] flex h-[16px] w-[16px] items-center justify-center rounded-pill border border-hairline bg-surface-card text-muted transition-colors duration-fast group-hover:text-ink"
        >
          <Icon icon={Pencil} size={9} />
        </span>
      </button>

      {open ? (
        <div
          ref={refs.setFloating}
          role="dialog"
          aria-label={t("agent.agents.builder.avatarLabel")}
          style={floatingStyles}
          className="z-20 w-[252px] animate-fade-in rounded-md border border-hairline bg-surface-card p-[10px] shadow-elevated"
        >
          <div className="grid grid-cols-8 gap-[2px]">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={e}
                onClick={() => {
                  onEmoji(e);
                  setOpen(false);
                }}
                className="flex h-[27px] w-[27px] items-center justify-center rounded-sm text-content transition-colors duration-fast hover:bg-surface-strong/55 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
              >
                {e}
              </button>
            ))}
          </div>
          <input
            value={draft.kind === "emoji" ? draft.value : ""}
            maxLength={EMOJI_INPUT_MAX}
            onChange={(e) => onEmoji(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setOpen(false);
            }}
            placeholder={t("agent.agents.builder.avatarEmojiCustom")}
            aria-label={t("agent.agents.builder.avatarEmojiCustom")}
            className="mt-[8px] h-[28px] w-full rounded-sm border border-hairline-soft bg-surface-1 px-[8px] text-center text-ui text-ink outline-none transition-colors duration-fast focus:border-ink"
          />
          <div className="mt-[8px] flex items-center justify-between gap-[6px] border-t border-hairline-soft pt-[8px]">
            <Button
              variant="subtle"
              size="sm"
              className="gap-[5px]"
              onClick={() => {
                onUpload();
                setOpen(false);
              }}
            >
              <Icon icon={ImagePlus} size={12} />
              {t("agent.agents.builder.avatarUpload")}
            </Button>
            {draft.kind !== "none" ? (
              <Button
                variant="ghost"
                size="sm"
                className="gap-[5px]"
                onClick={() => {
                  onRemove();
                  setOpen(false);
                }}
              >
                <Icon icon={X} size={12} />
                {t("agent.agents.builder.avatarRemove")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Create / edit an agent entity. Creation offers two explicit modes behind a
 * segmented control: "Create with AI" (describe the agent, one-shot prefill,
 * never auto-saved) and "Manual" (the form). A successful generation lands on
 * the Manual tab with the form prefilled for review. Edit mode is always the
 * form.
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

  const [mode, setMode] = useState<BuilderMode>("describe");
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
    setMode(entity ? "manual" : "describe");
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
      // Land on the form for review: generation prefills, the user saves.
      setMode("manual");
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
    // Split on the FIRST "/" only: modelIds may carry slashes themselves
    // (e.g. openrouter "anthropic/claude-x"); split("/", 2) would truncate.
    const sep = model.indexOf("/");
    const [providerId, modelId] =
      model && sep > 0 ? [model.slice(0, sep), model.slice(sep + 1)] : ["", ""];
    // Freshly picked photos are downscaled client-side before they ever cross
    // IPC ("keep" and emoji pass through untouched).
    let avatarInput = toAvatarInput(avatar);
    if (avatarInput?.kind === "image") {
      avatarInput = { kind: "image", dataUrl: await downscaleAvatar(avatarInput.dataUrl) };
    }
    const input: AgentEntityInput = {
      name: name.trim().slice(0, NAME_MAX),
      persona: persona.trim(),
      avatar: avatarInput,
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

  const describing = !isEdit && mode === "describe";

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width={620}
        title={isEdit ? t("agent.agents.builder.editTitle") : t("agent.agents.builder.newTitle")}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting || generating}>
              {t("agent.agents.builder.cancel")}
            </Button>
            {describing ? (
              // One primary action per screen: in describe mode it IS Generate.
              <Button
                variant="primary"
                size="sm"
                onClick={() => void generate()}
                disabled={!nl.trim() || generating}
                className="gap-[6px]"
              >
                <Icon
                  icon={generating ? Loader2 : Sparkles}
                  size={13}
                  className={cn(generating && "animate-spin")}
                />
                {t("agent.agents.builder.generate")}
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => void submit()} disabled={!canSubmit || submitting}>
                {t("agent.agents.builder.save")}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-[16px]">
          {!isEdit ? (
            <Segmented
              ariaLabel={t("agent.agents.builder.modeLabel")}
              value={mode}
              onChange={setMode}
              className="self-start"
              options={[
                { value: "describe", label: t("agent.agents.builder.modeDescribe"), icon: Sparkles },
                { value: "manual", label: t("agent.agents.builder.modeManual"), icon: SquarePen },
              ]}
            />
          ) : null}

          {describing ? (
            <div className="flex flex-col gap-[8px]">
              <textarea
                value={nl}
                onChange={(e) => setNl(e.target.value)}
                rows={5}
                autoFocus
                aria-label={t("agent.agents.builder.describeTitle")}
                placeholder={t("agent.agents.builder.describePlaceholder")}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void generate();
                  }
                }}
                className="w-full resize-none rounded-md border border-hairline-strong bg-surface-1 px-[12px] py-[10px] text-ui leading-[1.55] text-ink outline-none transition-colors duration-fast focus:border-ink"
              />
              <span className={cn("text-label leading-[1.4]", nlError ? "text-danger" : "text-muted-soft")}>
                {nlError ?? t("agent.agents.builder.describeHint")}
              </span>
            </div>
          ) : (
            <>
              {/* Identity row: ONE avatar control (emoji grid, free emoji,
                  photo, remove all live in its popover) + name. */}
              <div className="flex items-center gap-[14px]">
                <AvatarPicker
                  draft={avatar}
                  preview={previewAvatar}
                  onEmoji={(v) =>
                    setAvatar(v.trim() ? { kind: "emoji", value: v } : { kind: "none" })
                  }
                  onRemove={() => setAvatar({ kind: "none" })}
                  onUpload={() => fileRef.current?.click()}
                />
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
                <Field label={t("agent.agents.builder.name")} required className="min-w-0 flex-1">
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
            </>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-[6px]", className)}>
      <span className="text-caption font-medium text-body">
        {label}
        {required ? <span className="ml-[3px] text-danger">*</span> : null}
      </span>
      {children}
    </label>
  );
}
