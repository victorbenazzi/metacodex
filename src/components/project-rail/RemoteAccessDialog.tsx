import { FolderOpen, FolderPlus, Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useRemoteAccessDialogState } from "./useRemoteAccessDialogState";

interface RemoteAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RemoteAccessDialog({ open, onOpenChange }: RemoteAccessDialogProps) {
  const { t } = useTranslation();
  const {
    accesses,
    draft,
    busy,
    error,
    candidates,
    selectedPaths,
    setSelectedPaths,
    selectedCount,
    canConnect,
    canDiscover,
    fingerprint,
    needsTrust,
    updateDraft,
    resetDraft,
    selectAccess,
    pickIdentityFile,
    runTest,
    discover,
    addSelectedProjects,
    removeCurrent,
  } = useRemoteAccessDialogState({
    open,
    onOpenChange,
    pickIdentityTitle: t("remoteAccess.pickIdentityTitle"),
  });

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("remoteAccess.title")}
        description={t("remoteAccess.description")}
        width={760}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !draft.id || selectedCount === 0}
              onClick={addSelectedProjects}
            >
              <Icon icon={FolderPlus} size={12} />
              {t("remoteAccess.addSelected", { count: selectedCount })}
            </Button>
          </>
        }
      >
        <div className="grid min-h-[460px] grid-cols-[220px_minmax(0,1fr)] gap-[14px]">
          <aside className="min-h-0 rounded-sm border border-hairline-soft bg-canvas-soft/50 p-[8px]">
            <div className="mb-[8px] flex items-center justify-between gap-[8px]">
              <span className="editorial-caps text-muted">{t("remoteAccess.saved")}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-[24px] px-[7px]"
                aria-label={t("remoteAccess.newAccess")}
                onClick={resetDraft}
              >
                <Icon icon={Plus} size={12} />
                {t("remoteAccess.newAccess")}
              </Button>
            </div>
            <div className="space-y-[4px]">
              {accesses.map((access) => {
                const active = access.id === draft.id;
                return (
                  <button
                    type="button"
                    key={access.id}
                    onClick={() => selectAccess(access)}
                    className={cn(
                      "flex w-full flex-col rounded-sm px-[8px] py-[7px] text-left",
                      active ? "bg-surface-strong/70 text-ink" : "text-body hover:bg-surface-strong/45",
                    )}
                  >
                    <span className="truncate text-caption font-medium">{access.label}</span>
                    <span className="truncate font-mono text-label text-muted-soft">
                      {access.user}@{access.host}:{access.port}
                    </span>
                  </button>
                );
              })}
              {accesses.length === 0 ? (
                <p className="px-[4px] py-[8px] text-caption leading-[1.45] text-muted">
                  {t("remoteAccess.noSaved")}
                </p>
              ) : null}
            </div>
          </aside>

          <section className="min-w-0 space-y-[14px]">
            <div className="grid grid-cols-[1fr_1fr_90px] gap-[8px]">
              <Field
                id="remote-label"
                label={t("remoteAccess.fields.label")}
                value={draft.label}
                onChange={(value) => updateDraft({ label: value })}
                placeholder={t("remoteAccess.placeholders.label")}
              />
              <Field
                id="remote-host"
                label={t("remoteAccess.fields.host")}
                value={draft.host}
                onChange={(value) => updateDraft({ host: value })}
                placeholder={t("remoteAccess.placeholders.host")}
              />
              <Field
                id="remote-port"
                label={t("remoteAccess.fields.port")}
                value={draft.port}
                onChange={(value) => updateDraft({ port: value.replace(/\D/g, "") })}
                placeholder={t("remoteAccess.placeholders.port")}
              />
            </div>

            <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-[8px]">
              <Field
                id="remote-user"
                label={t("remoteAccess.fields.user")}
                value={draft.user}
                onChange={(value) => updateDraft({ user: value })}
                placeholder={t("remoteAccess.placeholders.user")}
              />
              <KeyFileField
                id="remote-identity"
                label={t("remoteAccess.fields.identityFile")}
                value={draft.identityFile}
                onChange={(value) => updateDraft({ identityFile: value })}
                onPick={pickIdentityFile}
                disabled={busy}
                placeholder={t("remoteAccess.placeholders.identityFile")}
                hint={t("remoteAccess.hints.identityFile")}
              />
            </div>

            <div className="space-y-[6px]">
              <label className="editorial-caps block" htmlFor="remote-roots">
                {t("remoteAccess.fields.roots")}
              </label>
              <textarea
                id="remote-roots"
                value={draft.rootsText}
                onChange={(event) => updateDraft({ rootsText: event.target.value })}
                placeholder={t("remoteAccess.placeholders.roots")}
                spellCheck={false}
                className="block h-[78px] w-full resize-none rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] font-mono text-caption text-ink outline-none placeholder:text-muted-soft focus:border-ink"
              />
              <p className="text-label leading-[1.45] text-muted-soft">
                {t("remoteAccess.hints.roots")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-[8px]">
              <Button variant="outline" size="sm" disabled={busy || !canConnect} onClick={() => runTest(false)}>
                {busy ? <Icon icon={Loader2} size={12} className="animate-spin" /> : <Icon icon={ShieldCheck} size={12} />}
                {t("remoteAccess.test")}
              </Button>
              {needsTrust ? (
                <Button variant="primary" size="sm" disabled={busy} onClick={() => runTest(true)}>
                  <Icon icon={ShieldCheck} size={12} />
                  {t("remoteAccess.trustHost")}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" disabled={busy || !canDiscover} onClick={discover}>
                <Icon icon={RefreshCw} size={12} />
                {t("remoteAccess.saveAndDiscover")}
              </Button>
              {draft.id ? (
                <Button variant="ghost" size="sm" disabled={busy} onClick={removeCurrent}>
                  <Icon icon={Trash2} size={12} />
                  {t("common.remove")}
                </Button>
              ) : null}
            </div>

            {fingerprint ? (
              <p className="rounded-sm border border-hairline-soft bg-canvas-soft px-[10px] py-[7px] font-mono text-label text-muted">
                {needsTrust ? t("remoteAccess.untrustedHost") : t("remoteAccess.trustedHost")}{" "}
                <span className="text-ink">{fingerprint}</span>
              </p>
            ) : null}

            {error ? (
              <p className="rounded-sm border border-danger/40 bg-danger/10 px-[10px] py-[7px] text-caption text-danger">
                {error}
              </p>
            ) : null}

            <div className="min-h-[150px] rounded-sm border border-hairline-soft">
              <div className="flex h-[32px] items-center justify-between border-b border-hairline-soft px-[10px]">
                <span className="editorial-caps text-muted">{t("remoteAccess.foundProjects")}</span>
                {candidates.length > 0 ? (
                  <span className="font-mono text-label text-muted-soft">{candidates.length}</span>
                ) : null}
              </div>
              <div className="max-h-[180px] overflow-y-auto p-[6px]">
                {candidates.length === 0 ? (
                  <p className="px-[4px] py-[16px] text-center text-caption text-muted">
                    {t("remoteAccess.noCandidates")}
                  </p>
                ) : (
                  candidates.map((candidate) => (
                    <label
                      key={candidate.path}
                      className="flex cursor-pointer items-start gap-[8px] rounded-sm px-[8px] py-[7px] hover:bg-surface-strong/45"
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedPaths[candidate.path]}
                        onChange={(event) =>
                          setSelectedPaths((prev) => ({
                            ...prev,
                            [candidate.path]: event.target.checked,
                          }))
                        }
                        className="mt-[2px]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-caption text-ink">{candidate.name}</span>
                        <span className="block truncate font-mono text-label text-muted-soft">
                          {candidate.path}
                        </span>
                        {candidate.markers.length > 0 ? (
                          <span className="mt-[3px] flex flex-wrap gap-[4px]">
                            {candidate.markers.slice(0, 4).map((marker) => (
                              <span
                                key={marker}
                                className="rounded-xs bg-surface-strong/60 px-[5px] py-[1px] font-mono text-micro text-muted"
                              >
                                {marker}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-[6px]">
      <label className="editorial-caps block" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="block w-full rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] font-mono text-caption text-ink outline-none placeholder:text-muted-soft focus:border-ink"
      />
      {hint ? <p className="text-label leading-[1.45] text-muted-soft">{hint}</p> : null}
    </div>
  );
}

function KeyFileField({
  id,
  label,
  value,
  onChange,
  onPick,
  disabled,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onPick: () => void;
  disabled: boolean;
  placeholder?: string;
  hint: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-[6px]">
      <label className="editorial-caps block" htmlFor={id}>
        {label}
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-[6px]">
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="block w-full rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] font-mono text-caption text-ink outline-none placeholder:text-muted-soft focus:border-ink"
        />
        <Button
          variant="outline"
          size="md"
          className="h-[32px] px-[10px] text-caption"
          disabled={disabled}
          onClick={onPick}
        >
          <Icon icon={FolderOpen} size={12} />
          {t("remoteAccess.chooseFile")}
        </Button>
      </div>
      <p className="text-label leading-[1.45] text-muted-soft">{hint}</p>
    </div>
  );
}
