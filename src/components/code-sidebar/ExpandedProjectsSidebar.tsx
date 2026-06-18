import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Settings } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { RenameProjectDialog } from "@/components/project-rail/RenameProjectDialog";
import { RemoveProjectDialog } from "@/components/project-rail/RemoveProjectDialog";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSettingsStore } from "@/features/settings/settings.store";
import { useResumeStore } from "@/features/resume/resume.store";
import type { Project } from "@/features/projects/project.types";
import { CodeProjectGroup } from "./CodeProjectGroup";

interface ExpandedProjectsSidebarProps {
  /** Used only by the no-projects empty state. Add-project + collapse live in the title bar. */
  onOpenFolder: () => void;
}

/**
 * Expanded form of the Code projects sidebar (the collapsed form is the icon
 * rail, MiniProjectSidebar). Same language as the Agent sidebar: a project list
 * where each project opens its nested Code sections (see CodeProjectGroup), with
 * a "+" (new terminal/agent in that project) and "⋯" (project options) on hover.
 * Rename/remove dialogs are owned here so every row's menu can reach them.
 */
export function ExpandedProjectsSidebar({ onOpenFolder }: ExpandedProjectsSidebarProps) {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const setSettingsOpen = useSettingsStore((s) => s.setOpen);

  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);

  // The Histórico section reads from the resume registry; warm it once.
  useEffect(() => {
    void useResumeStore.getState().hydrate();
  }, []);

  return (
    <aside
      className="atmosphere-soft flex h-full w-full flex-col overflow-hidden border-r border-hairline"
      aria-label={t("codeSidebar.projects")}
    >
      <header className="flex h-[30px] shrink-0 items-center border-b border-hairline-soft px-[14px]">
        <span className="editorial-caps truncate">{t("codeSidebar.projects")}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-[8px] py-[8px]">
        {projects.length === 0 ? (
          <div className="flex flex-col items-start gap-[10px] px-[8px] pt-[12px]">
            <p className="text-caption leading-[1.5] text-muted">{t("explorer.noProjectBody")}</p>
            <button
              type="button"
              onClick={onOpenFolder}
              className="inline-flex h-[28px] items-center gap-[6px] rounded-sm border border-hairline-strong bg-canvas px-[12px] text-caption font-medium text-ink transition-colors hover:bg-surface-strong/40"
            >
              <Icon icon={FolderOpen} size={13} className="text-muted" />
              {t("explorer.openFolder")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-[1px]">
            {projects.map((p) => (
              <CodeProjectGroup
                key={p.id}
                project={p}
                active={p.id === activeProjectId}
                onRequestRename={setRenameTarget}
                onRequestRemove={setRemoveTarget}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-hairline-soft px-[8px] py-[6px]">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[7px] text-left text-ui text-body transition-colors hover:bg-surface-strong/40 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
        >
          <Icon icon={Settings} size={13} className="text-muted" />
          {t("projectRail.settings")}
        </button>
      </footer>

      <RenameProjectDialog
        project={renameTarget}
        open={!!renameTarget}
        onOpenChange={(o) => !o && setRenameTarget(null)}
      />

      <RemoveProjectDialog
        project={removeTarget}
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
      />
    </aside>
  );
}
