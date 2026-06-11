import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, FileText, Loader2, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import {
  entityLifeApi,
  hotApplyEntities,
  useAgentEntitiesStore,
  type AgentActivity,
  type AgentEntity,
  type MemoryTree,
  type ProposalInfo,
} from "@/features/agent/entities.store";
import { useAgentCronStore } from "@/features/agent/cron.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { cn } from "@/lib/cn";

/** Lateral sections of an agent profile (phases 2-4 of AGENTS_DESIGN.md). */

function ts(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleString() : "";
}

function statusTone(status: string): string {
  if (status.startsWith("ok")) return "text-muted";
  if (status === "needs-you") return "text-warn";
  return "text-danger";
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export function MemorySection({ entity }: { entity: AgentEntity }) {
  const { t } = useTranslation();
  const [tree, setTree] = useState<MemoryTree | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // relPath
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setTree(await entityLifeApi.memoryTree(entity.id));
    } catch {
      setTree({ index: "", files: [], projects: [] });
    }
  }, [entity.id]);

  useEffect(() => {
    setSelected(null);
    setDirty(false);
    void reload();
  }, [reload]);

  const openFile = async (relPath: string) => {
    setSelected(relPath);
    setDirty(false);
    if (relPath === "MEMORY.md") {
      setContent(tree?.index ?? "");
      return;
    }
    try {
      setContent(await entityLifeApi.memoryRead(entity.id, relPath));
    } catch {
      setContent("");
    }
  };

  const save = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await entityLifeApi.memoryWrite(entity.id, selected, content);
      setDirty(false);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const removeFile = async (relPath: string) => {
    await entityLifeApi.memoryDelete(entity.id, relPath);
    if (selected === relPath) setSelected(null);
    await reload();
  };

  const fileRow = (relPath: string, name: string) => (
    <li key={relPath} className="group flex items-center gap-[6px]">
      <button
        type="button"
        onClick={() => void openFile(relPath)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-[8px] rounded-sm px-[8px] py-[5px] text-left text-ui transition-colors duration-fast",
          selected === relPath ? "bg-surface-2 text-ink" : "text-body hover:bg-surface-1",
        )}
      >
        <Icon icon={FileText} size={13} className="shrink-0 text-muted" />
        <span className="truncate">{name}</span>
      </button>
      {relPath !== "MEMORY.md" ? (
        <IconButton
          size="sm"
          aria-label={t("agent.agents.memory.delete")}
          title={t("agent.agents.memory.delete")}
          onClick={() => void removeFile(relPath)}
          className="opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Icon icon={Trash2} size={12} />
        </IconButton>
      ) : null}
    </li>
  );

  if (!tree) {
    return <p className="text-caption text-muted">{t("agent.agents.memory.loading")}</p>;
  }

  const empty =
    !tree.index.trim() && tree.files.length === 0 && tree.projects.length === 0;

  return (
    <div className="flex items-start gap-[20px]">
      <div className="w-[240px] shrink-0">
        <ul className="flex flex-col gap-[1px]">
          {fileRow("MEMORY.md", t("agent.agents.memory.index"))}
          {tree.files.map((f) => fileRow(f.relPath, f.name))}
        </ul>
        {tree.projects.map((p) => (
          <div key={p.key} className="mt-[12px]">
            <p className="px-[8px] pb-[3px] text-label uppercase tracking-label text-muted-soft">
              {p.key}
            </p>
            <ul className="flex flex-col gap-[1px]">
              {fileRow(`memory/projects/${p.key}/MEMORY.md`, t("agent.agents.memory.index"))}
              {p.files.map((f) => fileRow(f.relPath, f.name))}
            </ul>
          </div>
        ))}
        {empty ? (
          <p className="mt-[10px] px-[8px] text-caption leading-[1.5] text-muted-soft">
            {t("agent.agents.memory.emptyHint")}
          </p>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {selected ? (
          <>
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              rows={16}
              className="w-full resize-none rounded-md border border-hairline-strong bg-surface-1 px-[12px] py-[10px] font-mono text-caption leading-[1.6] text-ink outline-none transition-colors duration-fast focus:border-ink"
            />
            <div className="mt-[8px] flex items-center justify-between">
              <span className="font-mono text-label text-muted-soft">{selected}</span>
              <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
                {t("agent.agents.memory.save")}
              </Button>
            </div>
          </>
        ) : (
          <p className="pt-[8px] text-caption text-muted">
            {t("agent.agents.memory.pickFile")}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity (reports + run log)
// ---------------------------------------------------------------------------

export function ActivitySection({ entity }: { entity: AgentEntity }) {
  const { t } = useTranslation();
  const [activity, setActivity] = useState<AgentActivity | null>(null);
  const [openReport, setOpenReport] = useState<string | null>(null);

  useEffect(() => {
    setActivity(null);
    void entityLifeApi
      .activity(entity.id)
      .then(setActivity)
      .catch(() => setActivity({ reports: [], runs: [] }));
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
                  className="flex w-full items-center gap-[10px] px-[12px] py-[9px] text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-ui text-ink">{r.title}</span>
                  <span className="shrink-0 text-label uppercase tracking-label text-muted-soft">
                    {r.trigger}
                  </span>
                  <span className={cn("shrink-0 text-label", statusTone(r.status))}>
                    {t(`agent.agents.activity.status.${r.status}`, r.status)}
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
                {run.status}
                {run.continuations > 0
                  ? ` · ${t("agent.agents.activity.continuations", { count: run.continuations })}`
                  : ""}
              </span>
              <span className="shrink-0 text-label text-muted-soft">{ts(run.startedAt)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposals (the self-improvement queue, human gate)
// ---------------------------------------------------------------------------

export function ProposalsSection({ entity }: { entity: AgentEntity }) {
  const { t } = useTranslation();
  const [proposals, setProposals] = useState<ProposalInfo[] | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const reloadEntities = useAgentEntitiesStore((s) => s.load);

  const reload = useCallback(async () => {
    try {
      setProposals(await entityLifeApi.proposals(entity.id));
    } catch {
      setProposals([]);
    }
  }, [entity.id]);

  useEffect(() => {
    setProposals(null);
    void reload();
  }, [reload]);

  const resolve = async (file: string, approve: boolean, why?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await entityLifeApi.resolveProposal(entity.id, file, approve, why);
      setRejecting(null);
      setReason("");
      await reload();
      // An approved persona proposal rewrites AGENT.md; the compiled opencode
      // config changed, so hot-apply (dispose) + refresh the entity list.
      if (approve) {
        void hotApplyEntities();
        void reloadEntities();
      }
    } finally {
      setBusy(false);
    }
  };

  if (!proposals) {
    return <p className="text-caption text-muted">{t("agent.agents.proposals.loading")}</p>;
  }
  if (proposals.length === 0) {
    return (
      <EmptyState
        variant="panel"
        title={t("agent.agents.proposals.emptyTitle")}
        body={t("agent.agents.proposals.emptyBody")}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-[10px]">
      {proposals.map((p) => (
        <li key={p.file} className="rounded-lg border border-hairline bg-surface-card p-[12px]">
          <div className="flex items-center gap-[10px]">
            <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">{p.title}</span>
            <span className="shrink-0 rounded-pill bg-surface-1 px-[7px] py-[1px] text-[10px] uppercase tracking-label text-muted-soft">
              {p.kind}
            </span>
            {p.status !== "pending" ? (
              <span
                className={cn(
                  "shrink-0 text-label",
                  p.status === "approved" ? "text-muted" : "text-danger",
                )}
              >
                {t(`agent.agents.proposals.${p.status}`, p.status)}
              </span>
            ) : null}
          </div>
          <pre className="mt-[8px] max-h-[260px] overflow-y-auto whitespace-pre-wrap font-mono text-caption leading-[1.6] text-body">
            {p.content.trim()}
          </pre>
          {p.persona ? (
            <p className="mt-[6px] text-label text-muted-soft">
              {t("agent.agents.proposals.appliesPersona")}
            </p>
          ) : null}
          {p.status === "pending" ? (
            <div className="mt-[10px] flex items-center justify-end gap-[8px]">
              {rejecting === p.file ? (
                <>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t("agent.agents.proposals.reasonPlaceholder")}
                    autoFocus
                    className="h-[30px] min-w-0 flex-1 rounded-md border border-hairline-strong bg-surface-1 px-[10px] text-caption text-ink outline-none transition-colors duration-fast focus:border-ink"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void resolve(p.file, false, reason)}
                  >
                    {t("agent.agents.proposals.confirmReject")}
                  </Button>
                  <IconButton
                    size="md"
                    aria-label={t("agent.agents.builder.cancel")}
                    onClick={() => setRejecting(null)}
                  >
                    <Icon icon={X} size={13} />
                  </IconButton>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-[6px] text-danger"
                    disabled={busy}
                    onClick={() => setRejecting(p.file)}
                  >
                    <Icon icon={X} size={13} />
                    {t("agent.agents.proposals.reject")}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    className="gap-[6px]"
                    disabled={busy}
                    onClick={() => void resolve(p.file, true)}
                  >
                    <Icon icon={busy ? Loader2 : Check} size={13} className={cn(busy && "animate-spin")} />
                    {t("agent.agents.proposals.approve")}
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Agenda (heartbeat + dream + continuation knobs, plus the agent's crons)
// ---------------------------------------------------------------------------

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

  useEffect(() => {
    setHbEnabled(entity.heartbeat.enabled);
    setHbInterval(entity.heartbeat.intervalMinutes);
    setDreamAfter(entity.dreamAfterRuns);
    setCap(entity.continuationCap);
  }, [entity]);

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
    try {
      // Full input: the update command round-trips the whole entity; harness
      // knobs ride along, avatar stays as stored ("keep").
      await update(entity.id, {
        name: entity.name,
        persona: entity.persona,
        avatar: { kind: "keep" },
        color: entity.color,
        providerId: entity.providerId,
        modelId: entity.modelId,
        variant: entity.variant,
        permissionPreset: entity.permissionPreset,
        projects: entity.projects,
        heartbeat: { enabled: hbEnabled, intervalMinutes: hbInterval },
        dreamAfterRuns: dreamAfter,
        continuationCap: cap,
      });
    } finally {
      setSaving(false);
    }
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
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
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
        <div className="flex justify-end">
          <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {t("agent.agents.memory.save")}
          </Button>
        </div>
      </section>

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
