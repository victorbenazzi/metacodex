import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  DialogContent,
  DialogRoot,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useWorktreesStore } from "@/features/git/worktrees.store";
import { cliById, type CliTool } from "@/features/terminal/cli-registry";

interface WorktreeCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectPath: string;
  /** Pre-filled branch name. When empty we generate one based on cli id. */
  defaultBranchName: string;
  /** When this dialog is opened from the "+ → Run on isolated worktree" flow,
   *  pass the chosen cli so we can auto-suggest a friendly name and surface
   *  the launch button below the inputs. */
  defaultCliId: string | null;
  /** Fires after a successful create. The caller decides what to do — close
   *  the dialog and (optionally) launch a CLI tab in the new worktree. */
  onAfterCreate: (created: {
    branch: string;
    path: string;
    cli: CliTool | null;
  }) => void;
}

function randomSlug(): string {
  return Math.random().toString(36).slice(2, 6);
}

function suggestBranch(cliId: string | null): string {
  const prefix = cliId ? `agent/${cliId.toLowerCase()}` : "agent/wt";
  return `${prefix}-${randomSlug()}`;
}

export function WorktreeCreateDialog({
  open,
  onOpenChange,
  projectId,
  projectPath,
  defaultBranchName,
  defaultCliId,
  onAfterCreate,
}: WorktreeCreateDialogProps) {
  const { t } = useTranslation();
  const add = useWorktreesStore((s) => s.add);
  const [branchName, setBranchName] = useState("");
  const [baseRef, setBaseRef] = useState("HEAD");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cli = useMemo(() => (defaultCliId ? cliById(defaultCliId) ?? null : null), [defaultCliId]);

  useEffect(() => {
    if (!open) return;
    setBranchName(defaultBranchName || suggestBranch(defaultCliId));
    setBaseRef("HEAD");
    setError(null);
    setSubmitting(false);
  }, [open, defaultBranchName, defaultCliId]);

  const submit = async () => {
    const name = branchName.trim();
    if (!name) {
      setError(t("worktrees.dialog.branchInvalid") as string);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await add(projectId, projectPath, name, baseRef.trim() || undefined);
      onAfterCreate({ branch: name, path: created.path, cli });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent
        title={
          cli
            ? (t("worktrees.dialog.title", { cli: cli.label }) as string)
            : (t("worktrees.dialog.titleGeneric") as string)
        }
        description={t("worktrees.dialog.description") as string}
        width={440}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={submit} disabled={submitting}>
              {submitting
                ? t("worktrees.dialog.creating")
                : cli
                  ? t("worktrees.dialog.createAndLaunch")
                  : t("worktrees.dialog.create")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[14px]">
          <Field
            label={t("worktrees.dialog.branchLabel") as string}
            hint={t("worktrees.dialog.branchHint") as string}
          >
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              autoFocus
              className="w-full rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] font-mono text-[12px] text-ink outline-none focus-visible:border-ink"
            />
          </Field>
          <Field
            label={t("worktrees.dialog.baseLabel") as string}
            hint={t("worktrees.dialog.baseHint") as string}
          >
            <input
              type="text"
              value={baseRef}
              onChange={(e) => setBaseRef(e.target.value)}
              className="w-full rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] font-mono text-[12px] text-ink outline-none focus-visible:border-ink"
            />
          </Field>
          {error ? (
            <p className="text-[12px] text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-[5px]">
      <span className="text-[12px] font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}
