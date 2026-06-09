import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { documentDir } from "@tauri-apps/api/path";
import { FolderClosed } from "lucide-react";

import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useProjectsStore } from "@/features/projects/project.store";
import type { Project } from "@/features/projects/project.types";
import { isAppError } from "@/lib/ipc";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: Project) => void;
}

// A project name is a single folder segment — no separators, no dot-only names.
const NAME_INVALID = /[/\\\0]|^\.\.?$/;

/**
 * "Start from scratch" flow for the Agent View: name a project and pick the
 * parent directory; on save we create `directory/name` and register it (Rust
 * `create_project`), then hand the project back so the composer scopes to it.
 */
export function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const { t } = useTranslation();
  const create = useProjectsStore((s) => s.create);

  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset on open and pre-fill the parent with Documents so the common case is
  // one click (matching the clone dialog's behavior).
  useEffect(() => {
    if (!open) return;
    setName("");
    setDirectory("");
    setBusy(false);
    setErr(null);
    let cancelled = false;
    void documentDir()
      .then((docs) => {
        if (!cancelled) setDirectory(docs.replace(/\/+$/, ""));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const trimmedName = name.trim();
  const nameInvalid = trimmedName.length > 0 && NAME_INVALID.test(trimmedName);
  const canSubmit = !busy && trimmedName.length > 0 && directory.length > 0 && !nameInvalid;

  const chooseDirectory = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("agent.createProject.dirDialogTitle"),
      });
      if (typeof selected === "string" && selected.length > 0) setDirectory(selected);
    } catch (e) {
      console.error("[create-project] choose directory failed", e);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const project = await create(directory, trimmedName);
      onCreated(project);
      onOpenChange(false);
    } catch (e: unknown) {
      const raw = isAppError(e) ? e.message : e instanceof Error ? e.message : String(e);
      setErr(
        raw.toLowerCase().includes("already exists")
          ? t("agent.createProject.errExists", { name: trimmedName })
          : raw,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogRoot
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
      }}
    >
      <DialogContent
        title={t("agent.createProject.title")}
        width={460}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" disabled={!canSubmit} onClick={submit}>
              {busy ? t("agent.createProject.creating") : t("agent.createProject.create")}
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
            <label className="editorial-caps block" htmlFor="create-project-name">
              {t("agent.createProject.nameLabel")} <span className="text-danger">*</span>
            </label>
            <input
              id="create-project-name"
              type="text"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              className="block w-full rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] text-[13px] text-ink outline-none placeholder:text-muted-soft focus:border-ink disabled:opacity-60"
              placeholder={t("agent.createProject.namePlaceholder")}
              maxLength={200}
            />
            {nameInvalid ? (
              <p className="text-[11px] text-danger">{t("agent.createProject.nameInvalid")}</p>
            ) : null}
          </div>

          <div className="space-y-[6px]">
            <label className="editorial-caps block">
              {t("agent.createProject.dirLabel")} <span className="text-danger">*</span>
            </label>
            <button
              type="button"
              onClick={chooseDirectory}
              disabled={busy}
              className="flex w-full items-center gap-[8px] rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[8px] text-left outline-none transition-colors hover:bg-surface-strong/30 focus-visible:border-ink disabled:opacity-60"
            >
              <Icon icon={FolderClosed} size={14} className="shrink-0 text-muted" />
              {directory ? (
                <span className="truncate font-mono text-[12px] text-ink">{directory}</span>
              ) : (
                <span className="text-[12px] text-muted-soft">
                  {t("agent.createProject.dirPlaceholder")}
                </span>
              )}
            </button>
          </div>

          {err ? <p className="whitespace-pre-wrap text-[12px] text-danger">{err}</p> : null}
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
