import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { errMessage, qs } from "@/features/agent/oc";
import { SectionHeader } from "./PanelShell";

/** A persisted always-allow rule (`PermissionSavedInfo`). */
interface SavedPermission {
  id: string;
  projectID: string;
  action: string;
  resource: string;
}

/**
 * Review surface for the rules created by answering "Allow always" on a
 * permission card. Revoking one makes the agent ask again the next time.
 * The saved-permission API is keyed by projectID, NOT by directory (verified
 * against the 1.16 spec), so the project id is resolved first via
 * `GET /project/current?directory=`.
 */
export function PermissionsSection() {
  const { t } = useTranslation();
  const directory = useAgentChatStore((s) => s.directory);
  const [rows, setRows] = useState<SavedPermission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<SavedPermission | null>(null);

  const load = useCallback(async () => {
    const { baseUrl, directory: dir } = useAgentChatStore.getState();
    setRows(null);
    setError(null);
    if (!baseUrl) {
      setError(t("agent.permissions.loadFailed"));
      return;
    }
    try {
      const projRes = await fetch(`${baseUrl}/project/current${qs(dir)}`);
      if (!projRes.ok) throw new Error(`HTTP ${projRes.status}`);
      const project = (await projRes.json()) as { id?: string };
      const projectID = typeof project.id === "string" ? project.id : "";
      const res = await fetch(
        `${baseUrl}/api/permission/saved${
          projectID ? `?projectID=${encodeURIComponent(projectID)}` : ""
        }`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as { data?: unknown };
      const list = Array.isArray(payload?.data)
        ? (payload.data as Array<Record<string, unknown>>)
            .filter((r) => typeof r.id === "string" && r.id)
            .map((r) => ({
              id: r.id as string,
              projectID: typeof r.projectID === "string" ? r.projectID : "",
              action: typeof r.action === "string" ? r.action : "",
              resource: typeof r.resource === "string" ? r.resource : "",
            }))
        : [];
      setRows(list);
    } catch (e) {
      // Sidecar without this API (or offline): a calm error, never a dead tab.
      setError(errMessage(e));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, directory]);

  const revoke = async (row: SavedPermission) => {
    const { baseUrl } = useAgentChatStore.getState();
    if (!baseUrl) return;
    // Optimistic removal; a failed DELETE reloads the authoritative list.
    setRows((cur) => (cur ?? []).filter((r) => r.id !== row.id));
    try {
      const res = await fetch(`${baseUrl}/api/permission/saved/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      void load();
    }
  };

  return (
    <section>
      <SectionHeader
        title={t("agent.permissions.title")}
        subtitle={t("agent.permissions.subtitle")}
      />
      {error ? (
        <p className="text-ui text-danger">
          {t("agent.permissions.loadFailed")} ({error})
        </p>
      ) : rows === null ? (
        <div className="flex items-center gap-[8px] text-ui text-muted">
          <Icon icon={Loader2} size={14} className="animate-spin" />
          {t("agent.permissions.loading")}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          variant="panel"
          icon={ShieldCheck}
          title={t("agent.permissions.emptyTitle")}
          body={t("agent.permissions.emptyBody")}
        />
      ) : (
        <div className="flex flex-col gap-[8px]">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-[12px] rounded-lg border border-hairline bg-surface-card px-[14px] py-[10px]"
            >
              <code className="shrink-0 rounded-sm bg-surface-2 px-[6px] py-[2px] text-caption text-ink">
                {row.action || "action"}
              </code>
              <span className="min-w-0 flex-1 truncate font-mono text-caption text-muted">
                {row.resource}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setRevoking(row)}>
                <span className="text-danger">{t("agent.permissions.revoke")}</span>
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={t("agent.permissions.revokeConfirmTitle")}
        description={t("agent.permissions.revokeConfirmBody")}
        details={
          revoking ? (
            <span className="font-mono text-label">
              {revoking.action} {revoking.resource}
            </span>
          ) : undefined
        }
        confirmLabel={t("agent.permissions.revoke")}
        tone="destructive"
        onConfirm={() => {
          if (revoking) void revoke(revoking);
          setRevoking(null);
        }}
      />
    </section>
  );
}
