import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useProjectsStore } from "@/features/projects/project.store";
import type { Project } from "@/features/projects/project.types";

interface RenameProjectDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameProjectDialog({ project, open, onOpenChange }: RenameProjectDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rename = useProjectsStore((s) => s.rename);

  useEffect(() => {
    if (open && project) {
      setValue(project.name);
      setErr(null);
    }
  }, [open, project]);

  if (!project) return null;

  const trimmed = value.trim();
  const canSubmit = !busy && trimmed.length > 0 && trimmed !== project.name;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      await rename(project.id, trimmed);
      onOpenChange(false);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("projectRail.rename.title")}
        description={t("projectRail.rename.description")}
        width={420}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" disabled={!canSubmit} onClick={submit}>
              {busy ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-[10px]"
        >
          <label className="editorial-caps block" htmlFor="project-name-input">
            {t("projectRail.rename.label")}
          </label>
          <input
            id="project-name-input"
            type="text"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="block w-full rounded-sm border border-hairline-strong bg-canvas px-[10px] py-[7px] text-ui text-ink outline-none placeholder:text-muted-soft focus:border-ink"
            placeholder={project.name}
            maxLength={120}
          />
          <p className="font-mono text-label text-muted-soft">{project.path}</p>
          {err ? <p className="text-caption text-danger">{err}</p> : null}
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
