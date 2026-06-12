import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, X } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import {
  entityLifeApi,
  hotApplyEntities,
  useAgentEntitiesStore,
  type AgentEntity,
  type ProposalInfo,
} from "@/features/agent/entities.store";
import { cn } from "@/lib/cn";
import { lineDiff } from "@/lib/lineDiff";

/** Proposals tab of an agent profile: the self-improvement queue, human gate. */
export function ProposalsSection({ entity }: { entity: AgentEntity }) {
  const { t } = useTranslation();
  const [proposals, setProposals] = useState<ProposalInfo[] | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolveError, setResolveError] = useState(false);
  const reloadEntities = useAgentEntitiesStore((s) => s.load);

  const reload = useCallback(async () => {
    try {
      setProposals(await entityLifeApi.proposals(entity.id));
    } catch {
      setProposals([]);
    }
  }, [entity.id]);

  useEffect(() => {
    let cancelled = false;
    setProposals(null);
    setResolveError(false);
    void entityLifeApi
      .proposals(entity.id)
      .then((next) => {
        if (!cancelled) setProposals(next);
      })
      .catch(() => {
        if (!cancelled) setProposals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entity.id]);

  const resolve = async (file: string, approve: boolean, why?: string) => {
    if (busy) return;
    setBusy(true);
    setResolveError(false);
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
    } catch {
      setResolveError(true);
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
    <div className="flex flex-col gap-[10px]">
      {resolveError ? (
        <p className="text-caption leading-[1.5] text-danger">
          {t("agent.agents.proposals.resolveFailed")}
        </p>
      ) : null}
      <ul className="flex flex-col gap-[10px]">
        {proposals.map((p) => (
          <li key={p.file} className="rounded-lg border border-hairline bg-surface-card p-[12px]">
            <div className="flex items-center gap-[10px]">
              <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">{p.title}</span>
              <Badge tone="muted">{p.kind}</Badge>
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
            {p.kind === "persona" && p.persona ? (
              <PersonaDiff current={entity.persona} proposed={p.persona} />
            ) : (
              <pre className="mt-[8px] max-h-[260px] overflow-y-auto whitespace-pre-wrap font-mono text-caption leading-[1.6] text-body">
                {p.content.trim()}
              </pre>
            )}
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
    </div>
  );
}

/** Line diff of the proposed persona against the current one, so the human
 *  gate reviews the actual change instead of re-reading the whole text. */
function PersonaDiff({ current, proposed }: { current: string; proposed: string }) {
  const lines = lineDiff(current.trim(), proposed.trim());
  return (
    <div className="mt-[8px] max-h-[260px] overflow-y-auto rounded-md border border-hairline-soft bg-surface-1 font-mono text-caption leading-[1.6]">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre-wrap px-[10px]",
            line.type === "add" && "bg-success/[0.08] text-success",
            line.type === "del" && "bg-danger/[0.07] text-danger line-through decoration-danger/40",
            line.type === "same" && "text-body",
          )}
        >
          {line.text || " "}
        </div>
      ))}
    </div>
  );
}
