import { useEffect, useMemo, useState } from "react";
import { FolderPlus, Loader2, RefreshCw, Server, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useProjectsStore } from "@/features/projects/project.store";
import { remoteAccessApi } from "@/features/remote-access/remote-access.service";
import type {
  RemoteAccess,
  RemoteAccessDraft,
  RemoteAccessTestResult,
  RemoteProjectCandidate,
} from "@/features/remote-access/remote-access.types";
import { cn } from "@/lib/cn";

interface RemoteAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DraftState {
  id: string | null;
  label: string;
  host: string;
  port: string;
  user: string;
  identityFile: string;
  rootsText: string;
}

const emptyDraft = (): DraftState => ({
  id: null,
  label: "",
  host: "",
  port: "22",
  user: "",
  identityFile: "",
  rootsText: "/opt",
});

function draftFromAccess(access: RemoteAccess): DraftState {
  return {
    id: access.id,
    label: access.label,
    host: access.host,
    port: String(access.port || 22),
    user: access.user,
    identityFile: access.identityFile ?? "",
    rootsText: access.rootPaths.join("\n"),
  };
}

export function RemoteAccessDialog({ open, onOpenChange }: RemoteAccessDialogProps) {
  const { t } = useTranslation();
  const addRemote = useProjectsStore((s) => s.addRemote);
  const [accesses, setAccesses] = useState<RemoteAccess[]>([]);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<RemoteAccessTestResult | null>(null);
  const [candidates, setCandidates] = useState<RemoteProjectCandidate[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Record<string, boolean>>({});

  const selectedCount = Object.values(selectedPaths).filter(Boolean).length;
  const canSubmit = draft.host.trim() && draft.user.trim() && Number(draft.port) > 0;
  const fingerprint = testResult?.fingerprintSha256 ?? null;
  const needsTrust = testResult?.status === "untrusted";

  const loadAccesses = async () => {
    const list = await remoteAccessApi.list();
    setAccesses(list);
    if (!draft.id && list.length > 0) {
      setDraft(draftFromAccess(list[0]));
    }
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTestResult(null);
    setCandidates([]);
    setSelectedPaths({});
    void loadAccesses().catch((err) => setError(readError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const currentAccess = useMemo(
    () => accesses.find((access) => access.id === draft.id) ?? null,
    [accesses, draft.id],
  );

  const toRemoteDraft = (): RemoteAccessDraft => ({
    id: draft.id,
    label: draft.label.trim() || draft.host.trim(),
    host: draft.host.trim(),
    port: Number(draft.port || 22),
    user: draft.user.trim(),
    identityFile: draft.identityFile.trim() || null,
    rootPaths: draft.rootsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  });

  const updateDraft = (patch: Partial<DraftState>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setTestResult(null);
    setCandidates([]);
    setSelectedPaths({});
    setError(null);
  };

  const runTest = async (trustHost: boolean) => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await remoteAccessApi.test(toRemoteDraft(), trustHost);
      setTestResult(result);
      if (result.status === "trusted" && trustHost && currentAccess) {
        await loadAccesses();
      }
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const saveCurrent = async (): Promise<RemoteAccess | null> => {
    if (!canSubmit) return null;
    const saved = await remoteAccessApi.save(toRemoteDraft());
    setDraft(draftFromAccess(saved));
    const list = await remoteAccessApi.list();
    setAccesses(list);
    return saved;
  };

  const discover = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveCurrent();
      if (!saved) return;
      const found = await remoteAccessApi.discoverProjects(saved.id);
      setCandidates(found);
      setSelectedPaths(Object.fromEntries(found.map((candidate) => [candidate.path, true])));
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const addSelectedProjects = async () => {
    const accessId = draft.id;
    if (!accessId || selectedCount === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const candidate of candidates) {
        if (selectedPaths[candidate.path]) {
          await addRemote(accessId, candidate.path, candidate.name);
        }
      }
      onOpenChange(false);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const removeCurrent = async () => {
    if (!draft.id) return;
    setBusy(true);
    setError(null);
    try {
      await remoteAccessApi.remove(draft.id);
      setDraft(emptyDraft());
      setCandidates([]);
      setSelectedPaths({});
      const list = await remoteAccessApi.list();
      setAccesses(list);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

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
              <Button variant="ghost" size="icon" onClick={() => updateDraft(emptyDraft())}>
                <Icon icon={Server} size={13} />
              </Button>
            </div>
            <div className="space-y-[4px]">
              {accesses.map((access) => {
                const active = access.id === draft.id;
                return (
                  <button
                    type="button"
                    key={access.id}
                    onClick={() => updateDraft(draftFromAccess(access))}
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
                <p className="px-[4px] py-[8px] text-caption text-muted">
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
              />
              <Field
                id="remote-host"
                label={t("remoteAccess.fields.host")}
                value={draft.host}
                onChange={(value) => updateDraft({ host: value })}
              />
              <Field
                id="remote-port"
                label={t("remoteAccess.fields.port")}
                value={draft.port}
                onChange={(value) => updateDraft({ port: value.replace(/\D/g, "") })}
              />
            </div>

            <div className="grid grid-cols-2 gap-[8px]">
              <Field
                id="remote-user"
                label={t("remoteAccess.fields.user")}
                value={draft.user}
                onChange={(value) => updateDraft({ user: value })}
              />
              <Field
                id="remote-identity"
                label={t("remoteAccess.fields.identityFile")}
                value={draft.identityFile}
                onChange={(value) => updateDraft({ identityFile: value })}
                placeholder="~/.ssh/id_ed25519"
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
                spellCheck={false}
                className="block h-[78px] w-full resize-none rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] font-mono text-caption text-ink outline-none placeholder:text-muted-soft focus:border-ink"
              />
            </div>

            <div className="flex flex-wrap items-center gap-[8px]">
              <Button variant="outline" size="sm" disabled={busy || !canSubmit} onClick={() => runTest(false)}>
                {busy ? <Icon icon={Loader2} size={12} className="animate-spin" /> : <Icon icon={ShieldCheck} size={12} />}
                {t("remoteAccess.test")}
              </Button>
              {needsTrust ? (
                <Button variant="primary" size="sm" disabled={busy} onClick={() => runTest(true)}>
                  <Icon icon={ShieldCheck} size={12} />
                  {t("remoteAccess.trustHost")}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" disabled={busy || !canSubmit} onClick={discover}>
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
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
    </div>
  );
}

function readError(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === "object" && err && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
}
