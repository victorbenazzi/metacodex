import { useCallback, useEffect, useMemo, useState } from "react";

import { useProjectsStore } from "@/features/projects/project.store";
import { remoteAccessApi } from "@/features/remote-access/remote-access.service";
import type {
  RemoteAccess,
  RemoteAccessDraft,
  RemoteAccessTestResult,
  RemoteProjectCandidate,
} from "@/features/remote-access/remote-access.types";

interface UseRemoteAccessDialogStateArgs {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pickIdentityTitle: string;
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
  rootsText: "",
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

function readError(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === "object" && err && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
}

export function useRemoteAccessDialogState({
  open,
  onOpenChange,
  pickIdentityTitle,
}: UseRemoteAccessDialogStateArgs) {
  const addRemoteMany = useProjectsStore((s) => s.addRemoteMany);
  const [accesses, setAccesses] = useState<RemoteAccess[]>([]);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<RemoteAccessTestResult | null>(null);
  const [candidates, setCandidates] = useState<RemoteProjectCandidate[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Record<string, boolean>>({});

  const selectedCount = useMemo(
    () => Object.values(selectedPaths).filter(Boolean).length,
    [selectedPaths],
  );
  const rootPaths = useMemo(
    () =>
      draft.rootsText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [draft.rootsText],
  );
  const canConnect = Boolean(draft.host.trim() && draft.user.trim() && Number(draft.port) > 0);
  const canDiscover = canConnect && rootPaths.length > 0;
  const fingerprint = testResult?.fingerprintSha256 ?? null;
  const needsTrust = testResult?.status === "untrusted";

  const clearDiscoveryState = useCallback(() => {
    setTestResult(null);
    setCandidates([]);
    setSelectedPaths({});
    setError(null);
  }, []);

  const loadAccesses = useCallback(async (selectedId?: string | null) => {
    const list = await remoteAccessApi.list();
    setAccesses(list);
    setDraft((prev) => {
      const targetId = selectedId ?? prev.id;
      if (targetId) {
        const selected = list.find((access) => access.id === targetId);
        if (selected) return draftFromAccess(selected);
      }
      if (!prev.id && list.length > 0) return draftFromAccess(list[0]);
      return prev.id ? emptyDraft() : prev;
    });
    return list;
  }, []);

  useEffect(() => {
    if (!open) return;
    clearDiscoveryState();
    void loadAccesses().catch((err) => setError(readError(err)));
  }, [clearDiscoveryState, loadAccesses, open]);

  const currentAccess = useMemo(
    () => accesses.find((access) => access.id === draft.id) ?? null,
    [accesses, draft.id],
  );

  const toRemoteDraft = useCallback(
    (): RemoteAccessDraft => ({
      id: draft.id,
      label: draft.label.trim() || draft.host.trim(),
      host: draft.host.trim(),
      port: Number(draft.port || 22),
      user: draft.user.trim(),
      identityFile: draft.identityFile.trim() || null,
      rootPaths,
    }),
    [draft, rootPaths],
  );

  const updateDraft = useCallback(
    (patch: Partial<DraftState>) => {
      setDraft((prev) => ({ ...prev, ...patch }));
      clearDiscoveryState();
    },
    [clearDiscoveryState],
  );

  const resetDraft = useCallback(() => {
    setDraft(emptyDraft());
    clearDiscoveryState();
  }, [clearDiscoveryState]);

  const selectAccess = useCallback(
    (access: RemoteAccess) => {
      setDraft(draftFromAccess(access));
      clearDiscoveryState();
    },
    [clearDiscoveryState],
  );

  const pickIdentityFile = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const selected = await remoteAccessApi.pickIdentityFile(pickIdentityTitle);
      if (selected) {
        updateDraft({ identityFile: selected });
      }
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }, [pickIdentityTitle, updateDraft]);

  const runTest = useCallback(
    async (trustHost: boolean) => {
      if (!canConnect) return;
      setBusy(true);
      setError(null);
      try {
        const result = await remoteAccessApi.test(toRemoteDraft(), trustHost);
        setTestResult(result);
        if (result.status === "trusted" && trustHost && currentAccess) {
          await loadAccesses(currentAccess.id);
        }
      } catch (err) {
        setError(readError(err));
      } finally {
        setBusy(false);
      }
    },
    [canConnect, currentAccess, loadAccesses, toRemoteDraft],
  );

  const saveCurrent = useCallback(async (): Promise<RemoteAccess | null> => {
    if (!canDiscover) return null;
    const saved = await remoteAccessApi.save(toRemoteDraft());
    await loadAccesses(saved.id);
    return saved;
  }, [canDiscover, loadAccesses, toRemoteDraft]);

  const discover = useCallback(async () => {
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
  }, [saveCurrent]);

  const addSelectedProjects = useCallback(async () => {
    const accessId = draft.id;
    if (!accessId || selectedCount === 0) return;
    setBusy(true);
    setError(null);
    try {
      await addRemoteMany(
        accessId,
        candidates
          .filter((candidate) => selectedPaths[candidate.path])
          .map((candidate) => ({ path: candidate.path, name: candidate.name })),
      );
      onOpenChange(false);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }, [addRemoteMany, candidates, draft.id, onOpenChange, selectedCount, selectedPaths]);

  const removeCurrent = useCallback(async () => {
    if (!draft.id) return;
    setBusy(true);
    setError(null);
    try {
      await remoteAccessApi.remove(draft.id);
      setDraft(emptyDraft());
      setCandidates([]);
      setSelectedPaths({});
      setTestResult(null);
      const list = await remoteAccessApi.list();
      setAccesses(list);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }, [draft.id]);

  return {
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
  };
}
