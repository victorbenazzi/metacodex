import { useEffect, useState } from "react";
import * as Lucide from "lucide-react";
import { useTranslation } from "react-i18next";

import { DialogRoot, DialogContent } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { DirectoryPicker } from "./DirectoryPicker";
import { fsApi } from "@/features/filesystem/filesystem.service";
import { useProjectsStore } from "@/features/projects/project.store";
import type { Project } from "@/features/projects/project.types";
import { tileIconColor } from "@/features/projects/color";
import { isCustomIcon } from "@/features/projects/customIcon.service";
import { useThemeStore } from "@/features/theme/theme.store";
import { basename } from "@/lib/path";
import { cn } from "@/lib/cn";

export interface SentToProject {
  project: Project;
  oldPath: string;
  newPath: string;
  toDir: string;
}

interface SendToProjectDialogProps {
  file: { path: string; grantId: string } | null;
  onOpenChange: (open: boolean) => void;
  onSent: (result: SentToProject) => void;
}

export function SendToProjectDialog({ file, onOpenChange, onSent }: SendToProjectDialogProps) {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [destDir, setDestDir] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = file !== null;
  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  // Reset selection each time the dialog opens for a new file.
  useEffect(() => {
    if (!open) return;
    const first = projects[0] ?? null;
    setProjectId(first?.id ?? null);
    setDestDir(first?.path ?? "");
    setBusy(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file?.path]);

  const pickProject = (p: Project) => {
    setProjectId(p.id);
    setDestDir(p.path); // reset the destination to the chosen project's root
    setError(null);
  };

  const confirm = async () => {
    if (!file || !selectedProject || !destDir) return;
    setBusy(true);
    setError(null);
    try {
      const newPath = await fsApi.moveIntoProject(file.grantId, destDir);
      onSent({ project: selectedProject, oldPath: file.path, newPath, toDir: destDir });
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setBusy(false);
    }
  };

  const relDest =
    selectedProject && destDir.startsWith(selectedProject.path)
      ? destDir.slice(selectedProject.path.length).replace(/^\/+/, "") || ""
      : "";

  return (
    <DialogRoot
      open={open}
      onOpenChange={(o) => {
        if (!o) onOpenChange(false);
      }}
    >
      <DialogContent
        width={460}
        title={t("sendToProject.title")}
        description={file ? t("sendToProject.subtitle", { name: basename(file.path) }) : undefined}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={confirm}
              disabled={busy || !selectedProject || !destDir}
            >
              {busy ? t("sendToProject.moving") : t("sendToProject.confirm")}
            </Button>
          </>
        }
      >
        {projects.length === 0 ? (
          <p className="text-caption text-muted">{t("sendToProject.noProjects")}</p>
        ) : (
          <div className="space-y-[14px]">
            <div className="space-y-[6px]">
              <p className="editorial-caps text-muted">{t("sendToProject.pickProject")}</p>
              <div className="flex flex-wrap gap-[6px]">
                {projects.map((p) => (
                  <ProjectChip
                    key={p.id}
                    project={p}
                    active={p.id === projectId}
                    onClick={() => pickProject(p)}
                  />
                ))}
              </div>
            </div>

            {selectedProject ? (
              <div className="space-y-[6px]">
                <div className="flex items-baseline justify-between gap-[8px]">
                  <p className="editorial-caps text-muted">{t("sendToProject.pickFolder")}</p>
                  <p className="truncate font-mono text-label text-muted-soft">
                    {selectedProject.name}
                    {relDest ? `/${relDest}` : ""}
                  </p>
                </div>
                <DirectoryPicker
                  rootPath={selectedProject.path}
                  rootLabel={selectedProject.name}
                  selected={destDir}
                  onSelect={setDestDir}
                />
              </div>
            ) : null}

            {error ? <p className="text-caption text-danger">{error}</p> : null}
          </div>
        )}
      </DialogContent>
    </DialogRoot>
  );
}

function ProjectChip({
  project,
  active,
  onClick,
}: {
  project: Project;
  active: boolean;
  onClick: () => void;
}) {
  const theme = useThemeStore((s) => s.effective);
  const usesCustom = isCustomIcon(project.icon);
  const LucideIcon = !usesCustom
    ? ((Lucide as unknown as Record<string, Lucide.LucideIcon>)[project.icon] ?? null)
    : null;
  const accent = tileIconColor(project.color, theme);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-[28px] items-center gap-[6px] rounded-sm border px-[8px] text-caption transition-colors",
        active
          ? "border-hairline-strong bg-surface-strong/50 text-ink"
          : "border-hairline text-body hover:bg-surface-strong/30",
      )}
    >
      {usesCustom ? (
        <img
          src={project.icon}
          alt=""
          className="h-[14px] w-[14px] object-contain"
          draggable={false}
        />
      ) : LucideIcon ? (
        <LucideIcon size={13} strokeWidth={1.7} color={accent} aria-hidden />
      ) : (
        <span className="font-display text-caption leading-none" style={{ color: accent }}>
          {project.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="max-w-[120px] truncate">{project.name}</span>
    </button>
  );
}
