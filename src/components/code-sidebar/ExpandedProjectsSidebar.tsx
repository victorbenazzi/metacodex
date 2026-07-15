import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Settings } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { ReorderDropLine, useListReorder } from "@/components/ui/useListReorder";
import { ProjectGlyph } from "@/components/project-rail/ProjectGlyph";
import { RenameProjectDialog } from "@/components/project-rail/RenameProjectDialog";
import { RemoveProjectDialog } from "@/components/project-rail/RemoveProjectDialog";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSettingsStore } from "@/features/settings/settings.store";
import { useResumeStore } from "@/features/resume/resume.store";
import type { Project } from "@/features/projects/project.types";
import { cn } from "@/lib/cn";
import { CodeProjectGroup } from "./CodeProjectGroup";

interface ExpandedProjectsSidebarProps {
  /** Used only by the no-projects empty state. Add-project + collapse live in the title bar. */
  onOpenFolder: () => void;
}

/**
 * Expanded form of the Code projects sidebar (the collapsed form is the icon
 * rail, MiniProjectSidebar): a project list where each project opens its nested
 * Code sections (see CodeProjectGroup), with a "+" (new terminal/agent in that
 * project) and "⋯" (project options) on hover. Projects reorder with the same
 * shared drag gesture as the rail (`useListReorder`); nested section rows opt
 * out via `data-no-drag` so only the parent row starts a drag. Rename/remove
 * dialogs are owned here so every row's menu can reach them.
 */
export function ExpandedProjectsSidebar({ onOpenFolder }: ExpandedProjectsSidebarProps) {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const reorder = useProjectsStore((s) => s.reorder);
  const setSettingsOpen = useSettingsStore((s) => s.setOpen);

  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const drag = useListReorder({
    ids: projects.map((p) => p.id),
    onReorder: (ids) => void reorder(ids),
    onPointerMove: ({ x, y }) => {
      const ghost = ghostRef.current;
      if (!ghost) return;
      ghost.style.transform =
        `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(-2deg)`;
    },
  });
  const draggingProject = drag.draggingId
    ? projects.find((p) => p.id === drag.draggingId) ?? null
    : null;

  // The Histórico section reads from the resume registry; warm it once.
  useEffect(() => {
    void useResumeStore.getState().hydrate();
  }, []);

  return (
    <>
      <aside
        className="atmosphere-soft flex h-full w-full flex-col overflow-hidden rounded-lg border border-hairline"
        aria-label={t("codeSidebar.projects")}
      >
        <header className="flex h-[var(--panel-header-h)] shrink-0 items-center border-b border-hairline-soft px-[12px]">
          <span className="editorial-caps truncate">{t("codeSidebar.projects")}</span>
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-[8px] py-[8px]">
          {drag.indicatorTop !== null ? (
            <ReorderDropLine top={drag.indicatorTop} insetX={10} />
          ) : null}

          {projects.length === 0 ? (
            <div className="flex flex-col items-start gap-[10px] px-[8px] pt-[12px]">
              <p className="text-caption leading-[1.5] text-muted">{t("explorer.noProjectBody")}</p>
              <button
                type="button"
                onClick={onOpenFolder}
                className="inline-flex h-[28px] items-center gap-[6px] rounded-sm border border-hairline-strong bg-transparent px-[12px] text-caption font-medium text-ink transition-colors hover:bg-surface-strong/40"
              >
                <Icon icon={FolderOpen} size={12} className="text-muted" />
                {t("explorer.openFolder")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-[1px]">
              {projects.map((p) => (
                <div
                  key={p.id}
                  ref={drag.itemRef(p.id)}
                  {...drag.getItemProps(p.id)}
                  className={cn(
                    "touch-none transition-opacity duration-fast",
                    drag.draggingId === p.id && "opacity-30",
                  )}
                >
                  <CodeProjectGroup
                    project={p}
                    active={p.id === activeProjectId}
                    onRequestRename={setRenameTarget}
                    onRequestRemove={setRemoveTarget}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-hairline-soft px-[8px] py-[4px]">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[6px] text-left text-ui text-body transition-colors hover:bg-surface-strong/40 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
          >
            <Icon icon={Settings} size={14} className="text-muted" />
            {t("projectRail.settings")}
          </button>
        </footer>
      </aside>

      {/* Floating drag ghost — viewport-fixed and pointer-events:none so it
          glides under the cursor without intercepting events from the list. */}
      {draggingProject && drag.pointerPos ? (
        <div
          ref={ghostRef}
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-[1000] will-change-transform"
          style={{
            transform:
              `translate3d(${drag.pointerPos.x}px, ${drag.pointerPos.y}px, 0) ` +
              "translate(-50%, -50%) rotate(-2deg)",
          }}
        >
          <div className="flex h-[28px] max-w-[220px] items-center gap-[8px] rounded-md border border-hairline bg-surface-card px-[10px] shadow-drag">
            <ProjectGlyph project={draggingProject} size={14} />
            <span className="truncate text-ui text-ink">{draggingProject.name}</span>
          </div>
        </div>
      ) : null}

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
    </>
  );
}
