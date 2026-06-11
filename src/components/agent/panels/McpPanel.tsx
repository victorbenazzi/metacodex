import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Plug, RefreshCw, Search, Terminal, Trash2 } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Segmented } from "@/components/ui/Segmented";
import { cn } from "@/lib/cn";
import { SectionHeader } from "./PanelShell";
import { useAgentChatStore } from "@/features/agent/chat.store";
import {
  REDACTED,
  useAgentMcpStore,
  type FeaturedServerDef,
  type McpServerEntry,
  type McpServerInput,
} from "@/features/agent/mcp.store";

/**
 * MCP server management. Featured servers (web search: Brave, Exa) are
 * one-key-paste enables; custom servers take a command line (local) or URL
 * (remote). Every change is staged into the metacodex-managed opencode config
 * layer and only takes effect after the user restarts the agent; the inline
 * restart bar is the contract, never a silent restart. Rendered as a tab inside
 * the Customize page.
 */
export function McpSection() {
  const { t } = useTranslation();
  const store = useAgentMcpStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerEntry | null>(null);

  useEffect(() => {
    if (!store.loaded) void store.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live status while the tab is visible: a server that crashes (or finishes
  // its npx cold start) must not keep a stale dot forever.
  useEffect(() => {
    const id = setInterval(() => void useAgentMcpStore.getState().refreshStatus(), 15_000);
    return () => clearInterval(id);
  }, []);

  const customs = useMemo(() => store.entries.filter((e) => !e.featured), [store.entries]);

  return (
    <section>
      <SectionHeader
        title={t("agent.mcp.title")}
        subtitle={t("agent.mcp.subtitle")}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            {t("agent.mcp.addServer")}
          </Button>
        }
      />
      {store.pendingRestart ? <RestartBar /> : null}

      <h2 className="mb-[10px] mt-[4px] editorial-caps">{t("agent.mcp.featuredTitle")}</h2>
      <div className="grid grid-cols-1 gap-[12px] md:grid-cols-2">
        {store.featured.map((def) => (
          <FeaturedCard
            key={def.featured}
            def={def}
            entry={store.entries.find((e) => e.featured === def.featured) ?? null}
          />
        ))}
      </div>

      <h2 className="mb-[10px] mt-[24px] editorial-caps">{t("agent.mcp.customTitle")}</h2>
      {customs.length === 0 ? (
        <EmptyState
          variant="panel"
          icon={Plug}
          title={t("agent.mcp.emptyTitle")}
          body={t("agent.mcp.emptyBody")}
        />
      ) : (
        <div className="flex flex-col gap-[8px]">
          {customs.map((e) => (
            <ServerRow
              key={e.id}
              entry={e}
              onEdit={() => {
                setEditing(e);
                setDialogOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {store.error ? <p className="mt-[12px] text-caption text-danger">{store.error}</p> : null}

      <ServerDialog
        open={dialogOpen}
        entry={editing}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
      />
    </section>
  );
}

/** "Changes apply after the agent restarts" + the user-triggered restart.
 *  Disabled while a chat turn streams: restarting would kill it mid-reply. */
function RestartBar() {
  const { t } = useTranslation();
  const restart = useAgentMcpStore((s) => s.restart);
  const restarting = useAgentMcpStore((s) => s.restarting);
  const streaming = useAgentChatStore((s) => s.status !== "idle");
  return (
    <div className="mb-[16px] flex items-center justify-between gap-[12px] rounded-md border border-hairline bg-surface-2 px-[14px] py-[10px]">
      <p className="text-caption text-body">{t("agent.mcp.restartNote")}</p>
      <Button
        variant="primary"
        size="sm"
        disabled={restarting || streaming}
        onClick={() => void restart()}
      >
        <Icon icon={RefreshCw} size={12} className={cn(restarting && "animate-spin")} />
        {t("agent.mcp.restartButton")}
      </Button>
    </div>
  );
}

function StatusDot({ name }: { name: string }) {
  const { t } = useTranslation();
  const status = useAgentMcpStore((s) => s.status);
  if (!status) return null;
  const st = status[name];
  if (!st) return null;
  const ok = st.status === "connected" || st.status === "ok" || st.status === "ready";
  return (
    <span
      title={st.error ?? st.status ?? ""}
      aria-label={ok ? t("agent.mcp.statusConnected") : t("agent.mcp.statusError")}
      className={cn(
        "inline-block h-[7px] w-[7px] shrink-0 rounded-pill",
        ok ? "bg-success" : st.error ? "bg-danger" : "bg-muted-soft",
      )}
    />
  );
}

function FeaturedCard({ def, entry }: { def: FeaturedServerDef; entry: McpServerEntry | null }) {
  const { t } = useTranslation();
  const upsert = useAgentMcpStore((s) => s.upsert);
  const setEnabled = useAgentMcpStore((s) => s.setEnabled);
  const remove = useAgentMcpStore((s) => s.remove);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const enable = async () => {
    if (!key.trim()) return;
    setSaving(true);
    const ok = await upsert({
      name: def.name,
      kind: "local",
      command: def.command,
      environment: { [def.envVar]: key.trim() },
      enabled: true,
      featured: def.featured,
    });
    setSaving(false);
    if (ok) setKey("");
  };

  return (
    <div className="rounded-lg border border-hairline-soft bg-surface-card p-[14px]">
      <div className="flex items-center justify-between gap-[8px]">
        <div className="flex min-w-0 items-center gap-[8px]">
          <Icon icon={Search} size={14} className="shrink-0 text-muted" />
          <h3 className="truncate text-ui font-medium text-ink">{def.displayName}</h3>
          {entry ? <StatusDot name={def.name} /> : null}
        </div>
        {entry ? (
          <div className="flex shrink-0 items-center gap-[10px]">
            <Switch
              checked={entry.enabled}
              ariaLabel={t("agent.mcp.toggleAria", { name: def.displayName })}
              onChange={(next) => void setEnabled(entry.id, next)}
            />
            <button
              type="button"
              aria-label={t("agent.mcp.removeAria", { name: def.displayName })}
              onClick={() => setConfirmRemove(true)}
              className="rounded-sm p-[3px] text-muted hover:bg-surface-strong/55 hover:text-danger"
            >
              <Icon icon={Trash2} size={13} />
            </button>
          </div>
        ) : null}
      </div>
      {entry ? (
        <ConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title={t("agent.mcp.removeConfirmTitle")}
          description={t("agent.mcp.removeConfirmBody", { name: def.displayName })}
          confirmLabel={t("agent.mcp.removeConfirm")}
          tone="destructive"
          onConfirm={() => {
            setConfirmRemove(false);
            void remove(entry.id);
          }}
        />
      ) : null}
      <p className="mt-[6px] text-caption leading-[1.5] text-muted">{t(def.descriptionKey)}</p>
      {entry ? (
        <p className="mt-[8px] text-label text-muted-soft">
          {t("agent.mcp.keySet", { envVar: def.envVar })}
        </p>
      ) : (
        <div className="mt-[10px] flex items-center gap-[8px]">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void enable();
            }}
            placeholder={def.envVar}
            className="h-[28px] min-w-0 flex-1 rounded-sm border border-hairline bg-surface-1 px-[8px] text-caption text-ink outline-none placeholder:text-muted-soft focus:border-hairline-strong"
          />
          <Button variant="primary" size="sm" disabled={!key.trim() || saving} onClick={() => void enable()}>
            {t("agent.mcp.enable")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ServerRow({ entry, onEdit }: { entry: McpServerEntry; onEdit: () => void }) {
  const { t } = useTranslation();
  const setEnabled = useAgentMcpStore((s) => s.setEnabled);
  const remove = useAgentMcpStore((s) => s.remove);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const summary =
    entry.kind === "local" ? (entry.command ?? []).join(" ") : (entry.url ?? "");
  return (
    <div className="flex items-center gap-[12px] rounded-lg border border-hairline-soft bg-surface-card px-[14px] py-[10px]">
      <Icon icon={entry.kind === "local" ? Terminal : Globe} size={14} className="shrink-0 text-muted" />
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-[8px]">
          <span className="truncate text-ui font-medium text-ink">{entry.name}</span>
          <StatusDot name={entry.name} />
        </span>
        <span className="block truncate font-mono text-label text-muted">{summary}</span>
      </button>
      <Switch
        checked={entry.enabled}
        ariaLabel={t("agent.mcp.toggleAria", { name: entry.name })}
        onChange={(next) => void setEnabled(entry.id, next)}
      />
      <button
        type="button"
        aria-label={t("agent.mcp.removeAria", { name: entry.name })}
        onClick={() => setConfirmRemove(true)}
        className="rounded-sm p-[3px] text-muted hover:bg-surface-strong/55 hover:text-danger"
      >
        <Icon icon={Trash2} size={13} />
      </button>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t("agent.mcp.removeConfirmTitle")}
        description={t("agent.mcp.removeConfirmBody", { name: entry.name })}
        confirmLabel={t("agent.mcp.removeConfirm")}
        tone="destructive"
        onConfirm={() => {
          setConfirmRemove(false);
          void remove(entry.id);
        }}
      />
    </div>
  );
}

/** KEY=value per line ⇄ record. The sentinel value (redacted secret) survives. */
function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function kvToText(map: Record<string, string> | undefined): string {
  return Object.entries(map ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function ServerDialog({
  open,
  entry,
  onOpenChange,
}: {
  open: boolean;
  entry: McpServerEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const upsert = useAgentMcpStore((s) => s.upsert);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"local" | "remote">("local");
  const [command, setCommand] = useState("");
  const [env, setEnv] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [saving, setSaving] = useState(false);
  // Save failures render INSIDE the dialog; the panel-level error line sits
  // behind the modal overlay where the user can't see why Save did nothing.
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-seed the form whenever the dialog opens (create vs edit).
  useEffect(() => {
    if (!open) return;
    setName(entry?.name ?? "");
    setKind(entry?.kind ?? "local");
    setCommand((entry?.command ?? []).join(" "));
    setEnv(kvToText(entry?.environment));
    setUrl(entry?.url ?? "");
    setHeaders(kvToText(entry?.headers));
    setSaveError(null);
  }, [open, entry]);

  const nameValid = /^[a-z0-9][a-z0-9_-]*$/.test(name);
  const valid =
    nameValid &&
    (kind === "local" ? command.trim().length > 0 : /^https?:\/\//.test(url.trim()));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const input: McpServerInput =
      kind === "local"
        ? {
            id: entry?.id,
            name,
            kind,
            command: command.trim().split(/\s+/),
            environment: parseKv(env),
            enabled: entry?.enabled ?? true,
          }
        : {
            id: entry?.id,
            name,
            kind,
            url: url.trim(),
            headers: parseKv(headers),
            enabled: entry?.enabled ?? true,
          };
    const ok = await upsert(input);
    setSaving(false);
    if (ok) onOpenChange(false);
    else setSaveError(useAgentMcpStore.getState().error);
  };

  const inputCls =
    "h-[28px] w-full rounded-sm border border-hairline bg-surface-1 px-[8px] text-caption text-ink outline-none placeholder:text-muted-soft focus:border-hairline-strong";
  const areaCls =
    "min-h-[60px] w-full resize-y rounded-sm border border-hairline bg-surface-1 px-[8px] py-[6px] font-mono text-caption text-ink outline-none placeholder:text-muted-soft focus:border-hairline-strong";

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width={440}
        title={entry ? t("agent.mcp.editTitle") : t("agent.mcp.addTitle")}
        description={t("agent.mcp.dialogDescription", { sentinel: REDACTED })}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" disabled={!valid || saving} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[12px]">
          <label className="flex flex-col gap-[5px]">
            <span className="text-caption text-muted">{t("agent.mcp.fieldName")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-server"
              aria-invalid={name.length > 0 && !nameValid}
              className={inputCls}
            />
            {name.length > 0 && !nameValid ? (
              <span className="text-label text-danger">{t("agent.mcp.nameInvalid")}</span>
            ) : null}
          </label>

          <Segmented
            size="sm"
            ariaLabel={t("agent.mcp.fieldKind")}
            value={kind}
            onChange={(v: "local" | "remote") => setKind(v)}
            options={[
              { value: "local", label: t("agent.mcp.kindLocal") },
              { value: "remote", label: t("agent.mcp.kindRemote") },
            ]}
          />

          {kind === "local" ? (
            <>
              <label className="flex flex-col gap-[5px]">
                <span className="text-caption text-muted">{t("agent.mcp.fieldCommand")}</span>
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx -y some-mcp-server"
                  className={cn(inputCls, "font-mono")}
                />
              </label>
              <label className="flex flex-col gap-[5px]">
                <span className="text-caption text-muted">{t("agent.mcp.fieldEnv")}</span>
                <textarea
                  value={env}
                  onChange={(e) => setEnv(e.target.value)}
                  placeholder={"API_KEY=..."}
                  className={areaCls}
                />
              </label>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-[5px]">
                <span className="text-caption text-muted">{t("agent.mcp.fieldUrl")}</span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                  className={cn(inputCls, "font-mono")}
                />
              </label>
              <label className="flex flex-col gap-[5px]">
                <span className="text-caption text-muted">{t("agent.mcp.fieldHeaders")}</span>
                <textarea
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  placeholder={"Authorization=Bearer ..."}
                  className={areaCls}
                />
              </label>
            </>
          )}

          {saveError ? (
            <p className="text-caption leading-[1.5] text-danger">{saveError}</p>
          ) : null}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function Switch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-pill border transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
        checked
          ? "border-ink bg-ink"
          : "border-hairline-strong bg-surface-strong/40 hover:bg-surface-strong/60",
      )}
    >
      <span
        className={cn(
          "inline-block h-[12px] w-[12px] rounded-pill transition-transform",
          checked ? "translate-x-[16px] bg-on-primary" : "translate-x-[2px] bg-muted",
        )}
      />
    </button>
  );
}
