import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { documentDir } from "@tauri-apps/api/path";
import { FolderSearch, Loader2 } from "lucide-react";

import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useProjectsStore } from "@/features/projects/project.store";
import { cloneRepo, repoNameFromUrl } from "@/features/git/clone.service";
import { isAppError, CMD, invoke } from "@/lib/ipc";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";

interface CloneFromGithubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProgressState {
  phase: string;
  percent: number;
}

const FOLDER_NAME_INVALID = /[/\\\0]|^\.\.?$/;

export function CloneFromGithubDialog({ open, onOpenChange }: CloneFromGithubDialogProps) {
  const { t } = useTranslation();
  const addProject = useProjectsStore((s) => s.add);
  const notificationsEnabled = useSettingsDataStore(
    (s) => s.settings.notifications.osNotificationsEnabled,
  );
  const soundEnabled = useSettingsDataStore((s) => s.settings.notifications.soundEnabled);

  const [url, setUrl] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [folderName, setFolderName] = useState("");
  const [folderNameTouched, setFolderNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const cancelledRef = useRef(false);

  // Reset state every time the dialog opens. Also pre-fill the parent dir with
  // the user's Documents folder so the common case is a single-click flow.
  useEffect(() => {
    if (!open) return;
    setUrl("");
    setParentDir("");
    setFolderName("");
    setFolderNameTouched(false);
    setBusy(false);
    setErr(null);
    setProgress(null);
    cancelledRef.current = false;
    let cancelled = false;
    (async () => {
      try {
        const docs = await documentDir();
        if (!cancelled) setParentDir(docs.replace(/\/+$/, ""));
      } catch {
        // documentDir can fail (sandboxed envs, missing folder) — leave empty
        // and the user picks via "Choose…".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Auto-fill folder name from URL until the user manually edits it.
  useEffect(() => {
    if (folderNameTouched) return;
    const inferred = repoNameFromUrl(url);
    setFolderName(inferred);
  }, [url, folderNameTouched]);

  const chooseParent = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("cloneFromGithub.parent.dialogTitle"),
      });
      if (typeof selected === "string" && selected.length > 0) {
        setParentDir(selected);
      }
    } catch (e) {
      console.error("[clone] choose parent failed", e);
    }
  };

  const trimmedUrl = url.trim();
  const trimmedName = folderName.trim();
  const folderNameInvalid =
    trimmedName.length > 0 && FOLDER_NAME_INVALID.test(trimmedName);
  const canSubmit =
    !busy &&
    trimmedUrl.length > 0 &&
    parentDir.length > 0 &&
    trimmedName.length > 0 &&
    !folderNameInvalid;

  const destPreview =
    parentDir && trimmedName
      ? `${parentDir.replace(/\/+$/, "")}/${trimmedName}`
      : null;

  const mapErrorMessage = (raw: string): string => {
    const lower = raw.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("could not read username") ||
      lower.includes("terminal prompts disabled") ||
      lower.includes("permission denied (publickey)")
    ) {
      return t("cloneFromGithub.errors.authFailed");
    }
    if (lower.includes("repository not found") || lower.includes("not found")) {
      return t("cloneFromGithub.errors.notFound");
    }
    if (lower.includes("destination already exists") || lower.includes("already exists")) {
      return t("cloneFromGithub.errors.destExists", {
        name: trimmedName,
        parent: parentDir,
      });
    }
    if (
      lower.includes("could not resolve host") ||
      lower.includes("network is unreachable") ||
      lower.includes("connection refused") ||
      lower.includes("connection timed out")
    ) {
      return t("cloneFromGithub.errors.network");
    }
    return raw;
  };

  const submit = async () => {
    if (!canSubmit) return;
    cancelledRef.current = false;
    setBusy(true);
    setErr(null);
    setProgress(null);
    try {
      const dest = await cloneRepo({
        url: trimmedUrl,
        parentDir,
        folderName: trimmedName,
        onProgress: (p) => {
          if (!cancelledRef.current) setProgress(p);
        },
      });
      await addProject(dest);
      if (notificationsEnabled) {
        invoke(CMD.notifyShow, {
          title: t("cloneFromGithub.notify.successTitle"),
          body: t("cloneFromGithub.notify.successBody", { name: trimmedName }),
          sound: soundEnabled,
        }).catch(() => undefined);
      }
      onOpenChange(false);
    } catch (e: unknown) {
      const raw = isAppError(e) ? e.message : e instanceof Error ? e.message : String(e);
      setErr(mapErrorMessage(raw));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <DialogRoot
      open={open}
      onOpenChange={(o) => {
        if (busy) return; // refuse to close mid-clone
        cancelledRef.current = true;
        onOpenChange(o);
      }}
    >
      <DialogContent
        title={t("cloneFromGithub.title")}
        description={t("cloneFromGithub.description")}
        width={480}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" disabled={!canSubmit} onClick={submit}>
              {busy ? t("cloneFromGithub.submitting") : t("cloneFromGithub.submit")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-[14px]"
        >
          <div className="space-y-[6px]">
            <label className="editorial-caps block" htmlFor="clone-url-input">
              {t("cloneFromGithub.url.label")}
            </label>
            <input
              id="clone-url-input"
              type="text"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              className="block w-full rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] font-mono text-[12px] text-ink outline-none placeholder:text-muted-soft focus:border-ink disabled:opacity-60"
              placeholder={t("cloneFromGithub.url.placeholder")}
              maxLength={2048}
            />
          </div>

          <div className="space-y-[6px]">
            <label className="editorial-caps block" htmlFor="clone-parent-input">
              {t("cloneFromGithub.parent.label")}
            </label>
            <div className="flex items-stretch gap-[6px]">
              <input
                id="clone-parent-input"
                type="text"
                spellCheck={false}
                autoComplete="off"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                disabled={busy}
                className="block w-full rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] font-mono text-[12px] text-ink outline-none placeholder:text-muted-soft focus:border-ink disabled:opacity-60"
                placeholder={t("cloneFromGithub.parent.placeholder")}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={chooseParent}
                disabled={busy}
                className="shrink-0"
              >
                <Icon icon={FolderSearch} size={12} />
                {t("cloneFromGithub.parent.choose")}
              </Button>
            </div>
          </div>

          <div className="space-y-[6px]">
            <label className="editorial-caps block" htmlFor="clone-name-input">
              {t("cloneFromGithub.name.label")}
            </label>
            <input
              id="clone-name-input"
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={folderName}
              onChange={(e) => {
                setFolderName(e.target.value);
                if (!folderNameTouched) setFolderNameTouched(true);
              }}
              disabled={busy}
              className="block w-full rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] font-mono text-[12px] text-ink outline-none placeholder:text-muted-soft focus:border-ink disabled:opacity-60"
              placeholder={t("cloneFromGithub.name.placeholder")}
              maxLength={200}
            />
            {folderNameInvalid ? (
              <p className="text-[11px] text-danger">
                {t("cloneFromGithub.errors.nameInvalid")}
              </p>
            ) : null}
          </div>

          {destPreview ? (
            <p className="font-mono text-[11px] text-muted-soft">
              {t("cloneFromGithub.preview")}{" "}
              <span className="text-muted">{destPreview}</span>
            </p>
          ) : null}

          {busy ? (
            <div className="space-y-[6px]" aria-live="polite">
              <div className="flex items-center justify-between gap-[8px] text-[12px] text-muted">
                <span className="flex items-center gap-[6px]">
                  <Icon icon={Loader2} size={12} className="animate-spin" />
                  <span>{progress ? progress.phase : t("cloneFromGithub.connecting")}</span>
                </span>
                {progress && progress.percent > 0 ? (
                  <span className="font-mono tabular-nums">{progress.percent}%</span>
                ) : null}
              </div>
              <ProgressBar percent={progress?.percent ?? null} />
            </div>
          ) : null}

          {err ? <p className="text-[12px] text-danger whitespace-pre-wrap">{err}</p> : null}
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

/**
 * Thin progress track. When `percent` is null we render an indeterminate state:
 * a 33%-wide fill that slides across the track on a loop, signalling "still
 * working" while `git clone` is in pre-download phases (DNS, SSH handshake,
 * "Enumerating objects" — none of which report a percentage).
 */
function ProgressBar({ percent }: { percent: number | null }) {
  const indeterminate = percent === null;
  return (
    <div
      className="relative h-[4px] w-full overflow-hidden rounded-xs bg-hairline-soft"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : percent ?? 0}
    >
      {indeterminate ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1/3 bg-ink animate-progress-indeterminate"
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-ink transition-[width] duration-200 ease-out"
          style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }}
        />
      )}
    </div>
  );
}
