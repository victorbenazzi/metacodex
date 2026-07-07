import { useState } from "react";
import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { Kbd } from "@/components/ui/Kbd";
import { ReorderDropLine, useListReorder } from "@/components/ui/useListReorder";
import { ProjectTile } from "./ProjectTile";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { RenameProjectDialog } from "./RenameProjectDialog";
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSettingsStore } from "@/features/settings/settings.store";
import type { Project } from "@/features/projects/project.types";
import { cn } from "@/lib/cn";

// Collapsed form of the Code projects sidebar (the icon rail). The expand
// toggle and add-project controls live in the title bar; Settings stays here.
// Drag-to-reorder is the shared `useListReorder` gesture (same one the
// expanded sidebar uses); activation happens on pointerup because the tile's
// click is unreliable under WKWebView (see the hook's WKWebView note).
export function MiniProjectSidebar() {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const setActive = useProjectsStore((s) => s.setActive);
  const reorder = useProjectsStore((s) => s.reorder);

  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const setSettingsOpen = useSettingsStore((s) => s.setOpen);

  const drag = useListReorder({
    ids: projects.map((p) => p.id),
    onReorder: (ids) => void reorder(ids),
    onPressActivate: (id) => void setActive(id),
  });

  const draggingProject = drag.draggingId
    ? projects.find((p) => p.id === drag.draggingId) ?? null
    : null;

  return (
    <>
      <aside
        className="atmosphere-soft relative flex h-full w-full flex-col items-center overflow-hidden rounded-lg border border-hairline"
        aria-label={t("projectRail.ariaLabel")}
      >
        <div className="relative flex flex-1 flex-col items-center gap-[8px] overflow-y-auto overflow-x-hidden px-[8px] py-[14px]">
          {drag.indicatorTop !== null ? <ReorderDropLine top={drag.indicatorTop} /> : null}

          {projects.map((p) => (
            <div
              key={p.id}
              ref={drag.itemRef(p.id)}
              {...drag.getItemProps(p.id)}
              // touch-action: none prevents the WebView from interpreting
              // vertical pointer drags as page scroll, which would cancel
              // pointermove before we cross the drag threshold.
              className={cn(
                "relative touch-none transition-opacity duration-fast",
                drag.draggingId === p.id ? "opacity-30" : "opacity-100",
                // cursor: grab signals draggability; switches to grabbing
                // globally via body.is-reordering-projects.
                "cursor-grab active:cursor-grabbing",
              )}
            >
              <ProjectContextMenu
                project={p}
                onRequestRename={() => setRenameTarget(p)}
                onRequestRemove={() => setRemoveTarget(p)}
              >
                <ProjectTile
                  project={p}
                  active={p.id === activeProjectId}
                  isDragging={false}
                  onClick={() => void setActive(p.id)}
                />
              </ProjectContextMenu>
            </div>
          ))}
        </div>

        <div className="flex w-full shrink-0 flex-col items-center gap-[6px] border-t border-hairline-soft py-[10px]">
          <Tooltip content={t("projectRail.settings")} shortcut={<Kbd keys={["Mod", ","]} />} side="right">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className={cn(
                "inline-flex h-[28px] w-[28px] items-center justify-center rounded-sm",
                "text-muted hover:bg-surface-strong/55 hover:text-ink transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
              )}
              aria-label={t("projectRail.openSettings")}
            >
              <Icon icon={Settings} size={14} />
            </button>
          </Tooltip>
        </div>
      </aside>

      {/* Floating drag ghost — viewport-fixed and pointer-events:none so it
          glides under the cursor without intercepting events from the rail. */}
      {draggingProject && drag.pointerPos ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[1000]"
          style={{
            top: drag.pointerPos.y,
            left: drag.pointerPos.x,
            transform: "translate(-50%, -50%) rotate(-3deg)",
          }}
        >
          <div className="rounded-md shadow-drag">
            <ProjectTile
              project={draggingProject}
              active={draggingProject.id === activeProjectId}
              isDragging={false}
              onClick={() => undefined}
            />
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
