import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bot, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { LateralTabs } from "@/components/ui/LateralTabs";
import {
  selectEntityForChat,
  syncSelectedEntity,
  useAgentEntitiesStore,
  type AgentEntity,
} from "@/features/agent/entities.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { findModel, useAgentRuntimeStore } from "@/features/agent/runtime.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { CMD, invoke } from "@/lib/ipc";
import { cn } from "@/lib/cn";
import { AgentAvatarBadge } from "@/components/agent/entities/AgentAvatar";
import { AgentBuilderDialog } from "@/components/agent/entities/AgentBuilderDialog";
import {
  ActivitySection,
  AgendaSection,
  MemorySection,
  ProposalsSection,
} from "@/components/agent/entities/AgentProfileTabs";
import { PanelShell } from "./PanelShell";

type ProfileTab = "persona" | "memory" | "activity" | "proposals" | "agenda";
const PROFILE_TABS: ProfileTab[] = ["persona", "memory", "activity", "proposals", "agenda"];

/** Live status of the entities' autonomous runs (slug absent = idle). */
type EntityStatusMap = Record<string, "working" | "needs-you">;

const STATUS_POLL_MS = 5000;

/**
 * The Agents page: list of agent entities, or one agent's profile when
 * `nav.profileAgentId` is set. Phase 1 surface (see AGENTS_DESIGN.md): the
 * profile carries identity + persona; Memory/Schedule/Activity/Proposals tabs
 * land with phases 2-4.
 */
export function AgentsPanel() {
  const { t } = useTranslation();
  const entities = useAgentEntitiesStore((s) => s.entities);
  const loaded = useAgentEntitiesStore((s) => s.loaded);
  const load = useAgentEntitiesStore((s) => s.load);
  const profileAgentId = useAgentNavStore((s) => s.profileAgentId);
  const openAgents = useAgentNavStore((s) => s.openAgents);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<AgentEntity | null>(null);
  const [statuses, setStatuses] = useState<EntityStatusMap>({});

  useEffect(() => {
    void load().then(syncSelectedEntity);
  }, [load]);

  // Live run status, polled while the panel is mounted (the scheduler runs
  // headless: there is no event to push from). Best-effort: a failed tick
  // keeps the last known map.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const map = await invoke<EntityStatusMap>(CMD.agentEntityStatus);
        if (!cancelled) setStatuses(map);
      } catch {
        // sidecar/scheduler unavailable; keep the last snapshot
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const profile = profileAgentId ? entities.find((e) => e.id === profileAgentId) : null;

  return (
    <>
      {profile ? (
        <AgentProfile
          entity={profile}
          onBack={() => openAgents(null)}
          onEdit={() => {
            setEditing(profile);
            setBuilderOpen(true);
          }}
        />
      ) : (
        <PanelShell
          title={t("agent.agents.title")}
          subtitle={t("agent.agents.subtitle")}
          action={
            <Button
              variant="primary"
              size="sm"
              className="gap-[6px]"
              onClick={() => {
                setEditing(null);
                setBuilderOpen(true);
              }}
            >
              <Icon icon={Plus} size={13} />
              {t("agent.agents.new")}
            </Button>
          }
        >
          {loaded && entities.length === 0 ? (
            // Same empty-state anatomy as Scheduled Tasks: icon tile + display
            // title + action line, no card chrome.
            <div className="flex min-h-[52vh] flex-col items-center justify-center text-center">
              <span className="flex h-[64px] w-[64px] items-center justify-center rounded-xl bg-surface-strong/45">
                <Icon icon={Bot} size={28} className="text-muted-soft" strokeWidth={1.5} />
              </span>
              <p className="mt-[16px] font-display text-[16px] text-body">
                {t("agent.agents.emptyTitle")}
              </p>
              <p className="mt-[8px] max-w-[360px] text-ui leading-[1.55] text-muted">
                {t("agent.agents.emptyBody")}
              </p>
              <p className="mt-[8px] text-ui text-muted">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setBuilderOpen(true);
                  }}
                  className="font-medium text-ink underline-offset-2 hover:underline"
                >
                  {t("agent.agents.emptyAction")}
                </button>
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-[8px]">
              {entities.map((e) => (
                <AgentRow
                  key={e.id}
                  entity={e}
                  status={statuses[e.id]}
                  onOpen={() => openAgents(e.id)}
                />
              ))}
            </ul>
          )}
        </PanelShell>
      )}

      <AgentBuilderDialog
        open={builderOpen}
        onOpenChange={(open) => {
          setBuilderOpen(open);
          if (!open) {
            setEditing(null);
            // An edit may have changed model/preset of the selected entity.
            syncSelectedEntity();
          }
        }}
        entity={editing}
      />
    </>
  );
}

function startChatWith(entity: AgentEntity) {
  selectEntityForChat(entity);
  const nav = useAgentNavStore.getState();
  nav.setSection("chat");
}

/** 6px live-run dot, same vocabulary as the Code view's TabStatusDot:
 *  working = soft pulsing update tint, needs-you = static warn. Idle agents
 *  render nothing so the list stays quiet. */
function EntityStatusDot({ status }: { status?: "working" | "needs-you" }) {
  const { t } = useTranslation();
  if (!status) return null;
  const label =
    status === "working"
      ? t("agent.agents.status.working")
      : t("agent.agents.status.needsYou");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-block h-[6px] w-[6px] shrink-0 rounded-pill",
        status === "working"
          ? "animate-tab-status-pulse bg-[var(--update-blue)]"
          : "bg-warn",
      )}
    />
  );
}

function AgentRow({
  entity,
  status,
  onOpen,
}: {
  entity: AgentEntity;
  status?: "working" | "needs-you";
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const providers = useAgentRuntimeStore((s) => s.providers);
  // Display name from the catalog when it's loaded; raw id otherwise.
  const modelLabel = entity.modelId
    ? ((entity.providerId
        ? findModel(providers, entity.providerId, entity.modelId)?.name
        : undefined) ?? entity.modelId)
    : t("agent.agents.builder.modelInherit");

  // The row opens the profile; the chat shortcut is a SIBLING control (never
  // a button nested inside a button), absolutely placed over the row's end.
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-[12px] rounded-lg border border-hairline bg-surface-card py-[12px] pl-[14px] pr-[48px] text-left transition-colors duration-fast hover:border-hairline-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
      >
        <AgentAvatarBadge avatar={entity.avatar} color={entity.color} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-[7px]">
            <span className="truncate text-ui font-medium text-ink">{entity.name}</span>
            <EntityStatusDot status={status} />
          </span>
          <span className="block truncate text-caption text-muted">
            {modelLabel} · {t(`agent.permission.${entity.permissionPreset}`)}
          </span>
        </span>
      </button>
      <IconButton
        size="lg"
        aria-label={t("agent.agents.chat")}
        title={t("agent.agents.chat")}
        onClick={() => startChatWith(entity)}
        className="absolute right-[12px] top-1/2 -translate-y-1/2"
      >
        <Icon icon={MessageSquare} size={14} />
      </IconButton>
    </li>
  );
}

function AgentProfile({
  entity,
  onBack,
  onEdit,
}: {
  entity: AgentEntity;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const selectedId = useSettingsDataStore((s) => s.settings.agent.entityId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<ProfileTab>("persona");

  // A different agent's profile always opens on Persona.
  useEffect(() => setTab("persona"), [entity.id]);

  const projectsLabel = entity.projects
    ? entity.projects
        .map((id) => projects.find((p) => p.id === id)?.name ?? id)
        .join(", ")
    : t("agent.agents.builder.projectsAll");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-[28px] py-[28px]">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mb-[16px] gap-[6px] text-muted hover:text-ink"
        >
          <Icon icon={ArrowLeft} size={13} />
          {t("agent.agents.back")}
        </Button>

        <header className="mb-[24px] flex items-start justify-between gap-[16px]">
          <div className="flex min-w-0 items-center gap-[14px]">
            <AgentAvatarBadge avatar={entity.avatar} color={entity.color} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate font-display text-[24px] tracking-[-0.01em] text-ink">
                {entity.name}
              </h1>
              <p className="mt-[2px] truncate font-mono text-label text-muted-soft">
                {entity.opencodeName}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-[8px]">
            <Button variant="outline" size="sm" className="gap-[6px]" onClick={onEdit}>
              <Icon icon={Pencil} size={13} />
              {t("agent.agents.edit")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="gap-[6px]"
              onClick={() => startChatWith(entity)}
            >
              <Icon icon={MessageSquare} size={13} />
              {t("agent.agents.chat")}
            </Button>
          </div>
        </header>

        {/* Lateral tabs, same anatomy as the Customize page. */}
        <div className="flex items-start gap-[24px]">
          <LateralTabs
            tabs={PROFILE_TABS.map((id) => ({ id, label: t(`agent.agents.tabs.${id}`) }))}
            value={tab}
            onChange={setTab}
            ariaLabel={t("agent.agents.tabsLabel")}
            className="w-[148px]"
          />

          <div className="min-w-0 flex-1">
            {tab === "persona" ? (
              <>
                <section className="mb-[20px] grid grid-cols-3 gap-[12px]">
                  <MetaCard
                    label={t("agent.agents.builder.model")}
                    value={entity.modelId ?? t("agent.agents.builder.modelInherit")}
                  />
                  <MetaCard
                    label={t("agent.agents.builder.permission")}
                    value={t(`agent.permission.${entity.permissionPreset}`)}
                  />
                  <MetaCard label={t("agent.agents.builder.projects")} value={projectsLabel} />
                </section>
                <pre className="whitespace-pre-wrap rounded-lg border border-hairline bg-surface-card px-[16px] py-[14px] font-mono text-caption leading-[1.6] text-body">
                  {entity.persona.trim() || t("agent.agents.personaEmpty")}
                </pre>
                <section className="mt-[20px] border-t border-hairline-soft pt-[16px]">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-[6px] text-danger"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Icon icon={Trash2} size={13} />
                    {t("agent.agents.delete")}
                  </Button>
                </section>
              </>
            ) : tab === "memory" ? (
              <MemorySection entity={entity} />
            ) : tab === "activity" ? (
              <ActivitySection entity={entity} />
            ) : tab === "proposals" ? (
              <ProposalsSection entity={entity} />
            ) : (
              <AgendaSection entity={entity} />
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="destructive"
        title={t("agent.agents.deleteConfirmTitle")}
        description={t("agent.agents.deleteConfirmBody", { name: entity.name })}
        confirmLabel={t("agent.agents.delete")}
        pending={deleting}
        onConfirm={() => {
          setDeleting(true);
          void useAgentEntitiesStore
            .getState()
            .remove(entity.id)
            .then((ok) => {
              setDeleting(false);
              if (ok) {
                setConfirmDelete(false);
                if (selectedId === entity.id) selectEntityForChat(null);
                useAgentNavStore.getState().openAgents(null);
              }
            });
        }}
      />
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-card px-[12px] py-[10px]">
      <p className="text-label uppercase tracking-label text-muted-soft">{label}</p>
      <p className="mt-[3px] truncate text-ui text-ink" title={value}>
        {value}
      </p>
    </div>
  );
}
