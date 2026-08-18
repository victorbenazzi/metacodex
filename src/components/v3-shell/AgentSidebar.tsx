import { useEffect, useRef, useState, type ReactNode } from "react";
import { FolderPlus, Plus, RefreshCw, Search, Settings, Sliders } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { ReorderDropLine, useListReorder } from "@/components/ui/useListReorder";
import { ProjectGlyph } from "@/components/project-rail/ProjectGlyph";
import { RenameProjectDialog } from "@/components/project-rail/RenameProjectDialog";
import { RemoveProjectDialog } from "@/components/project-rail/RemoveProjectDialog";
import { LoopsList } from "@/components/v3-shell/LoopsList";
import { RepoRow } from "@/components/v3-shell/RepoRow";
import { useProjectsStore } from "@/features/projects/project.store";
import { useResumeStore } from "@/features/resume/resume.store";
import { useSettingsStore } from "@/features/settings/settings.store";
import { useV3ShellStore } from "@/features/v3-shell/v3Shell.store";
import { useSearchUiStore } from "@/features/search/search.store";
import type { Project } from "@/features/projects/project.types";
import { cn } from "@/lib/cn";
import { isMac } from "@/lib/platform";

export function AgentSidebar() {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const reorder = useProjectsStore((s) => s.reorder);
  const setSettingsOpen = useSettingsStore((s) => s.setOpen);
  const leftNav = useV3ShellStore((s) => s.leftNav);
  const setLeftNav = useV3ShellStore((s) => s.setLeftNav);
  const setNewAgentOpen = useV3ShellStore((s) => s.setNewAgentOpen);
  const setOpenProjectOpen = useV3ShellStore((s) => s.setOpenProjectOpen);
  const setSearchOpen = useSearchUiStore((s) => s.setOpen);

  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [sortAz, setSortAz] = useState(false);
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const listed = sortAz
    ? [...projects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    : projects;

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

  useEffect(() => {
    void useResumeStore.getState().hydrate();
  }, []);

  return (
    <>
      <aside
        className="flex h-full w-full flex-col border-r border-hairline-soft bg-canvas"
        aria-label={t("v3.sidebar.aria")}
      >
        <SidebarHeader />

        <div className="flex flex-col gap-[2px] px-6px pt-8px">
          <NavRow
            icon={Plus}
            label={t("v3.newAgent.button")}
            trailing={
              <span className="font-mono text-label leading-none text-muted">
                {isMac ? "⌘N" : "Ctrl+N"}
              </span>
            }
            onClick={() => setNewAgentOpen(true)}
          />
          <NavRow
            icon={Search}
            label={t("v3.nav.search")}
            onClick={() => setSearchOpen(true)}
          />
          <NavRow
            icon={RefreshCw}
            label={t("v3.nav.loops")}
            active={leftNav === "loops"}
            onClick={() => setLeftNav(leftNav === "loops" ? "repos" : "loops")}
          />
        </div>

        <div className="mt-12px flex min-h-0 flex-1 flex-col">
          {leftNav === "loops" ? (
            <>
              <div className="flex h-[28px] shrink-0 items-center px-16px">
                <span className="text-caption text-muted">{t("v3.nav.loops")}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pb-8px">
                <LoopsList />
              </div>
            </>
          ) : (
            <>
              <div className="flex h-[28px] shrink-0 items-center px-12px">
                <span className="min-w-0 flex-1 text-caption text-body">
                  {t("v3.repos.title")}
                </span>
                <Tooltip content={t("v3.repos.filter")} side="bottom">
                  <button
                    type="button"
                    aria-label={t("v3.repos.filter")}
                    aria-pressed={sortAz}
                    onClick={() => setSortAz((v) => !v)}
                    className={cn(
                      "inline-flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-sm transition-colors duration-fast hover:bg-surface-strong hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
                      sortAz ? "bg-surface-strong text-ink" : "text-muted",
                    )}
                  >
                    <Icon icon={Sliders} size={12} />
                  </button>
                </Tooltip>
                <Tooltip content={t("v3.repos.open")} side="bottom">
                  <button
                    type="button"
                    aria-label={t("v3.repos.open")}
                    onClick={() => setOpenProjectOpen(true)}
                    className="inline-flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-sm text-muted transition-colors duration-fast hover:bg-surface-strong hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
                  >
                    <Icon icon={FolderPlus} size={12} />
                  </button>
                </Tooltip>
              </div>
              <div className="relative min-h-0 flex-1 overflow-y-auto px-6px pb-8px">
                {drag.indicatorTop !== null && !sortAz ? (
                  <ReorderDropLine top={drag.indicatorTop} insetX={8} />
                ) : null}
                {projects.length === 0 ? (
                  <p className="px-10px pt-8px text-caption leading-[1.5] text-muted">
                    {t("v3.repos.empty")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-[2px]">
                    {listed.map((p) => (
                      <div
                        key={p.id}
                        ref={sortAz ? undefined : drag.itemRef(p.id)}
                        {...(sortAz ? {} : drag.getItemProps(p.id))}
                        className={cn(
                          "touch-none transition-opacity duration-fast",
                          drag.draggingId === p.id && "opacity-30",
                        )}
                      >
                        <RepoRow
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
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center border-t border-hairline-soft px-8px py-8px">
          <NavRow
            icon={Settings}
            label={t("projectRail.settings")}
            onClick={() => setSettingsOpen(true)}
          />
        </footer>
      </aside>

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
          <div className="flex h-[28px] max-w-[220px] items-center gap-8px rounded-md border border-hairline bg-surface-card px-10px shadow-drag">
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

function SidebarHeader() {
  return (
    <div
      data-tauri-drag-region
      className={cn(
        "flex h-[var(--title-bar-h)] shrink-0 items-center",
        isMac ? "pl-[94px] pr-8px" : "px-10px",
      )}
    >
    </div>
  );
}

function NavRow({
  icon,
  label,
  active,
  onClick,
  trailing,
}: {
  icon: typeof Search;
  label: string;
  active?: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-[32px] w-full cursor-pointer items-center gap-8px rounded-sm px-8px text-ui leading-none transition-colors duration-fast",
        active
          ? "bg-surface-strong text-ink"
          : "text-ink hover:bg-surface-strong/40",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
      )}
    >
      <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center">
        <Icon icon={icon} size={15} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left leading-none">{label}</span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </button>
  );
}

