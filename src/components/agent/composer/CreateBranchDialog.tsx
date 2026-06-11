import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { gitApi } from "@/features/git/git.service";
import { isAppError } from "@/lib/ipc";

interface CreateBranchDialogProps {
  root: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

// Mirror the Rust `valid_branch_name`: no leading dash, no "..", git-safe chars.
const BRANCH_INVALID = /[^\w\-./]|\.\./;

/** Create a branch off HEAD and switch to it (Rust `git_create_branch`). */
export function CreateBranchDialog({ root, open, onOpenChange, onCreated }: CreateBranchDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setBusy(false);
    setErr(null);
  }, [open]);

  const trimmed = name.trim();
  const invalid = trimmed.length > 0 && (BRANCH_INVALID.test(trimmed) || trimmed.startsWith("-"));
  const canSubmit = !busy && trimmed.length > 0 && !invalid;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      await gitApi.createBranch(root, trimmed);
      onCreated();
      onOpenChange(false);
    } catch (e: unknown) {
      setErr(isAppError(e) ? e.message : e instanceof Error ? e.message : String(e));
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
        title={t("agent.branch.createTitle")}
        width={420}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" disabled={!canSubmit} onClick={submit}>
              {busy ? t("agent.branch.creating") : t("agent.branch.create")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-[6px]"
        >
          <label className="editorial-caps block" htmlFor="create-branch-name">
            {t("agent.branch.nameLabel")}
          </label>
          <input
            id="create-branch-name"
            type="text"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            className="block w-full rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] font-mono text-caption text-ink outline-none placeholder:text-muted-soft focus:border-ink disabled:opacity-60"
            placeholder={t("agent.branch.namePlaceholder")}
            maxLength={200}
          />
          {invalid ? (
            <p className="text-label text-danger">{t("agent.branch.nameInvalid")}</p>
          ) : null}
          {err ? <p className="whitespace-pre-wrap text-caption text-danger">{err}</p> : null}
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
