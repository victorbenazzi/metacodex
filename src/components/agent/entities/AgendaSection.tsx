import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { useAgentCronStore } from "@/features/agent/cron.store";
import { useAgentEntitiesStore, type AgentEntity } from "@/features/agent/entities.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { CMD, invoke } from "@/lib/ipc";

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Agenda tab: heartbeat + dream + continuation knobs, the HEARTBEAT.md
 *  checklist editor, plus the agent's scheduled tasks. */
export function AgendaSection({ entity }: { entity: AgentEntity }) {
  const { t } = useTranslation();
  const update = useAgentEntitiesStore((s) => s.update);
  const cronTasks = useAgentCronStore((s) => s.tasks);
  const loadCrons = useAgentCronStore((s) => s.load);
  const openScheduled = useAgentNavStore((s) => s.setSection);

  const [hbEnabled, setHbEnabled] = useState(entity.heartbeat.enabled);
  const [hbInterval, setHbInterval] = useState(entity.heartbeat.intervalMinutes);
  const [dreamAfter, setDreamAfter] = useState(entity.dreamAfterRuns);
  const [cap, setCap] = useState(entity.continuationCap);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Reset the knobs only when the agent (or its STORED values) change, never
  // on a mere list reload: `entity` is a fresh object reference on every
  // load(), and depending on the reference wiped what the user was typing.
  const { enabled: storedHbEnabled, intervalMinutes: storedHbInterval } = entity.heartbeat;
  const { dreamAfterRuns: storedDreamAfter, continuationCap: storedCap } = entity;
  useEffect(() => {
    setHbEnabled(storedHbEnabled);
    setHbInterval(storedHbInterval);
    setDreamAfter(storedDreamAfter);
    setCap(storedCap);
  }, [entity.id, storedHbEnabled, storedHbInterval, storedDreamAfter, storedCap]);

  useEffect(() => {
    void loadCrons();
  }, [loadCrons]);

  const dirty =
    hbEnabled !== entity.heartbeat.enabled ||
    hbInterval !== entity.heartbeat.intervalMinutes ||
    dreamAfter !== entity.dreamAfterRuns ||
    cap !== entity.continuationCap;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(false);
    // Knobs are clamped on blur, but a save triggered straight from typing
    // (Enter, programmatic) must not round-trip an out-of-range value.
    const interval = clamp(hbInterval, 5, 1440);
    const dreams = clamp(dreamAfter, 1, 100);
    const capped = clamp(cap, 0, 50);
    // The update command round-trips the whole entity, so the identity fields
    // ride along: read them from the FRESHEST store snapshot (the prop may be
    // stale if an edit landed while this tab was open).
    const fresh =
      useAgentEntitiesStore.getState().entities.find((e) => e.id === entity.id) ?? entity;
    // `update` never throws: it returns null and stashes the message in the
    // store's `error` field.
    const res = await update(entity.id, {
      name: fresh.name,
      persona: fresh.persona,
      avatar: { kind: "keep" },
      color: fresh.color,
      providerId: fresh.providerId,
      modelId: fresh.modelId,
      variant: fresh.variant,
      permissionPreset: fresh.permissionPreset,
      projects: fresh.projects,
      heartbeat: { enabled: hbEnabled, intervalMinutes: interval },
      dreamAfterRuns: dreams,
      continuationCap: capped,
    });
    if (!res) setSaveError(true);
    setSaving(false);
  };

  const myCrons = cronTasks.filter((c) => c.agentId === entity.id);

  const numField = (
    label: string,
    value: number,
    onChange: (n: number) => void,
    min: number,
    max: number,
  ) => (
    <label className="flex items-center justify-between gap-[12px]">
      <span className="text-ui text-body">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        // Clamp on BLUR, not per keystroke: clamping while typing turns
        // "15" into "55" (the leading "1" snaps to min before the "5" lands).
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        onBlur={(e) => onChange(clamp(Number(e.target.value) || min, min, max))}
        className="h-[30px] w-[88px] rounded-md border border-hairline-strong bg-surface-1 px-[10px] text-right text-ui tabular-nums text-ink outline-none transition-colors duration-fast focus:border-ink"
      />
    </label>
  );

  return (
    <div className="flex max-w-[480px] flex-col gap-[18px]">
      <section className="flex flex-col gap-[10px]">
        <label className="flex items-center justify-between gap-[12px]">
          <span className="flex flex-col">
            <span className="text-ui text-body">{t("agent.agents.agenda.heartbeat")}</span>
            <span className="text-label text-muted-soft">
              {t("agent.agents.agenda.heartbeatHint")}
            </span>
          </span>
          <input
            type="checkbox"
            checked={hbEnabled}
            onChange={(e) => setHbEnabled(e.target.checked)}
            className="accent-current"
          />
        </label>
        {hbEnabled
          ? numField(t("agent.agents.agenda.heartbeatInterval"), hbInterval, setHbInterval, 5, 1440)
          : null}
        {numField(t("agent.agents.agenda.dreamAfter"), dreamAfter, setDreamAfter, 1, 100)}
        {numField(t("agent.agents.agenda.continuationCap"), cap, setCap, 0, 50)}
        {saveError ? (
          <p className="text-caption leading-[1.5] text-danger">
            {t("agent.agents.agenda.saveFailed")}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {t("agent.agents.memory.save")}
          </Button>
        </div>
      </section>

      <HeartbeatFileEditor entityId={entity.id} />

      <section>
        <h3 className="mb-[8px] text-caption font-medium text-body">
          {t("agent.agents.agenda.crons")}
        </h3>
        {myCrons.length === 0 ? (
          <p className="text-caption leading-[1.5] text-muted-soft">
            {t("agent.agents.agenda.noCrons")}
          </p>
        ) : (
          <ul className="flex flex-col gap-[4px]">
            {myCrons.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-[10px] rounded-md border border-hairline bg-surface-card px-[10px] py-[7px]"
              >
                <span className="min-w-0 flex-1 truncate text-ui text-ink">{c.title}</span>
                <span className="shrink-0 font-mono text-label text-muted">{c.cron}</span>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="subtle"
          size="sm"
          className="mt-[8px]"
          onClick={() => openScheduled("scheduled")}
        >
          {t("agent.agents.agenda.manageCrons")}
        </Button>
      </section>
    </div>
  );
}

/** Editor of the agent's HEARTBEAT.md (the checklist every heartbeat reads).
 *  Same anatomy as the memory editor: mono textarea, dirty-gated save. */
function HeartbeatFileEditor({ entityId }: { entityId: string }) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setDirty(false);
    setErrorKey(null);
    void invoke<string>(CMD.agentEntityHeartbeatRead, { id: entityId })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (cancelled) return;
        setContent("");
        setErrorKey("agent.agents.agenda.heartbeatLoadFailed");
      });
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const save = async () => {
    if (content === null || saving) return;
    setSaving(true);
    setErrorKey(null);
    try {
      await invoke<void>(CMD.agentEntityHeartbeatWrite, { id: entityId, content });
      setDirty(false);
    } catch {
      setErrorKey("agent.agents.agenda.heartbeatSaveFailed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-[8px]">
      <div className="flex flex-col">
        <h3 className="text-caption font-medium text-body">
          {t("agent.agents.agenda.heartbeatFile")}
        </h3>
        <p className="text-label leading-[1.4] text-muted-soft">
          {t("agent.agents.agenda.heartbeatFileHint")}
        </p>
      </div>
      {content === null && !errorKey ? (
        <p className="text-caption text-muted">{t("agent.agents.agenda.heartbeatLoading")}</p>
      ) : (
        <>
          <textarea
            value={content ?? ""}
            aria-label={t("agent.agents.agenda.heartbeatFile")}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            rows={8}
            className="w-full resize-none rounded-md border border-hairline-strong bg-surface-1 px-[12px] py-[10px] font-mono text-caption leading-[1.6] text-ink outline-none transition-colors duration-fast focus:border-ink"
          />
          {errorKey ? (
            <p className="text-caption leading-[1.5] text-danger">{t(errorKey)}</p>
          ) : null}
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {t("agent.agents.memory.save")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
