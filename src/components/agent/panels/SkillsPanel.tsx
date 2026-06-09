import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Loader2 } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { CMD, invoke } from "@/lib/ipc";
import { PanelShell } from "./PanelShell";

interface SkillInfo {
  name: string;
  description: string;
  source: string;
  path: string;
}

/**
 * Inventory of Agent Skills discoverable on disk (opencode / claude / agents /
 * metacodex skill dirs). Read-only for now; authoring + linking to agents lands
 * with the harness work.
 */
export function SkillsPanel() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    invoke<SkillInfo[]>(CMD.agentListSkills)
      .then((s) => {
        if (alive) setSkills(s);
      })
      .catch((e) => {
        if (alive) setError(e && typeof e === "object" && "message" in e ? String(e.message) : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PanelShell title={t("agent.skills.title")} subtitle={t("agent.skills.subtitle")}>
      {skills === null ? (
        <div className="flex items-center gap-[8px] text-[13px] text-muted">
          <Icon icon={Loader2} size={14} className="animate-spin" />
          {t("agent.skills.loading")}
        </div>
      ) : skills.length === 0 ? (
        <EmptyState
          variant="panel"
          icon={BookOpen}
          title={t("agent.skills.emptyTitle")}
          body={t("agent.skills.emptyBody")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-[12px] md:grid-cols-2">
          {skills.map((s) => (
            <SkillCard key={s.path} skill={s} />
          ))}
        </div>
      )}
      {error ? <p className="mt-[12px] text-[12px] text-danger">{error}</p> : null}
    </PanelShell>
  );
}

function SkillCard({ skill }: { skill: SkillInfo }) {
  return (
    <div className="rounded-lg border border-hairline-soft bg-surface-card p-[14px] transition-colors hover:border-hairline-strong">
      <div className="flex items-center justify-between gap-[8px]">
        <h3 className="truncate text-[13px] font-medium text-ink">{skill.name}</h3>
        <span className="shrink-0 rounded-pill bg-surface-1 px-[7px] py-[1px] text-[10px] uppercase tracking-[0.05em] text-muted-soft">
          {skill.source}
        </span>
      </div>
      <p className="mt-[6px] line-clamp-3 text-[12px] leading-[1.5] text-muted">
        {skill.description}
      </p>
    </div>
  );
}
