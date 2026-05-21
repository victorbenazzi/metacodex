import { useState, type DragEvent } from "react";
import { FolderPlus, Settings, Trash2 } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { Kbd } from "@/components/ui/Kbd";
import { Button } from "@/components/ui/Button";
import {
  DialogContent,
  DialogRoot,
} from "@/components/ui/Dialog";
import { ProjectTile } from "./ProjectTile";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { RenameProjectDialog } from "./RenameProjectDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSettingsStore } from "@/features/settings/settings.store";
import type { Project } from "@/features/projects/project.types";
import { cn } from "@/lib/cn";

interface MiniProjectSidebarProps {
  onOpenFolder: () => void;
}

interface DropTarget {
  id: string;
  pos: "before" | "after";
}

export function MiniProjectSidebar({ onOpenFolder }: MiniProjectSidebarProps) {
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const setActive = useProjectsStore((s) => s.setActive);
  const remove = useProjectsStore((s) => s.remove);
  const reorder = useProjectsStore((s) => s.reorder);

  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const settingsOpen = useSettingsStore((s) => s.open);
  const setSettingsOpen = useSettingsStore((s) => s.setOpen);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const resetDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  const onTileDragStart = (id: string) => (e: DragEvent<HTMLButtonElement>) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", id);
    } catch {
      // Some WKWebView contexts reject setData with non-text/uri MIME types — ignore.
    }
  };

  const onTileDragOver = (id: string) => (e: DragEvent<HTMLButtonElement>) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggingId === id) {
      setDropTarget(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    const pos: "before" | "after" = e.clientY < middle ? "before" : "after";
    setDropTarget((prev) =>
      prev?.id === id && prev.pos === pos ? prev : { id, pos },
    );
  };

  const onTileDrop = (id: string) => (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingId || draggingId === id || !dropTarget) {
      resetDrag();
      return;
    }
    const ids = projects.map((p) => p.id);
    const from = ids.indexOf(draggingId);
    let to = ids.indexOf(id);
    if (from < 0 || to < 0) {
      resetDrag();
      return;
    }
    if (dropTarget.pos === "after") to += 1;
    const next = [...ids];
    next.splice(from, 1);
    const insertAt = from < to ? to - 1 : to;
    next.splice(insertAt, 0, draggingId);
    resetDrag();
    void reorder(next);
  };

  // Container-level dragOver: always allow drop with the "move" cursor so the
  // WKWebView doesn't paint the cursor as "+" (copy) or "🚫" (no-drop) over
  // the gaps between tiles.
  const onRailDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onRailDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropTarget(null);
    }
  };

  return (
    <>
      <aside
        className="relative flex h-full w-full flex-col items-center overflow-hidden border-r border-hairline bg-canvas-soft"
        aria-label="Project rail"
      >
        <div
          className="flex flex-1 flex-col items-center gap-[8px] overflow-y-auto overflow-x-hidden px-[8px] py-[14px]"
          onDragOver={onRailDragOver}
          onDragLeave={onRailDragLeave}
        >
          {projects.map((p) => {
            const dropPos =
              dropTarget?.id === p.id && draggingId && draggingId !== p.id
                ? dropTarget.pos
                : null;
            return (
              <div key={p.id} className="relative">
                {/* Drop indicator lines, drawn outside the button so the tile doesn't shift */}
                {dropPos === "before" ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-[5px] left-[2px] right-[2px] h-[2px] rounded-full bg-ink/80"
                  />
                ) : null}
                {dropPos === "after" ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -bottom-[5px] left-[2px] right-[2px] h-[2px] rounded-full bg-ink/80"
                  />
                ) : null}

                <ProjectContextMenu
                  project={p}
                  onRequestRename={() => setRenameTarget(p)}
                  onRequestRemove={() => setRemoveTarget(p)}
                >
                  <ProjectTile
                    project={p}
                    active={p.id === activeProjectId}
                    isDragging={draggingId === p.id}
                    onClick={() => setActive(p.id)}
                    draggable
                    onDragStart={onTileDragStart(p.id)}
                    onDragOver={onTileDragOver(p.id)}
                    onDragEnd={resetDrag}
                    onDrop={onTileDrop(p.id)}
                  />
                </ProjectContextMenu>
              </div>
            );
          })}
        </div>

        <div className="flex w-full shrink-0 flex-col items-center gap-[6px] border-t border-hairline-soft py-[10px]">
          <Tooltip content="Open folder" shortcut={<Kbd keys={["Mod", "O"]} />} side="right">
            <button
              type="button"
              onClick={onOpenFolder}
              className={cn(
                "inline-flex h-[32px] w-[32px] items-center justify-center rounded-sm",
                "text-muted hover:bg-surface-strong/55 hover:text-ink transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
              )}
              aria-label="Open folder"
            >
              <Icon icon={FolderPlus} size={15} />
            </button>
          </Tooltip>

          <Tooltip content="Settings" shortcut={<Kbd keys={["Mod", ","]} />} side="right">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className={cn(
                "inline-flex h-[32px] w-[32px] items-center justify-center rounded-sm",
                "text-muted hover:bg-surface-strong/55 hover:text-ink transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
              )}
              aria-label="Open settings"
            >
              <Icon icon={Settings} size={14} />
            </button>
          </Tooltip>
        </div>
      </aside>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <RenameProjectDialog
        project={renameTarget}
        open={!!renameTarget}
        onOpenChange={(o) => !o && setRenameTarget(null)}
      />

      <DialogRoot
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
      >
        {removeTarget && (
          <DialogContent
            title="Remove project from metacodex?"
            description="This only removes the project from your workspace. The folder on disk is not affected."
            width={420}
            footer={
              <>
                <Button variant="outline" size="sm" onClick={() => setRemoveTarget(null)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={async () => {
                    const t = removeTarget;
                    setRemoveTarget(null);
                    await remove(t.id);
                  }}
                  className="bg-danger text-on-primary hover:bg-danger/85"
                >
                  <Icon icon={Trash2} size={12} className="text-on-primary" />
                  Remove
                </Button>
              </>
            }
          >
            <div className="space-y-[8px]">
              <p className="text-[13px] text-body">
                <span className="font-medium text-ink">{removeTarget.name}</span> will be removed from the rail.
              </p>
              <p className="font-mono text-[11px] text-muted-soft">{removeTarget.path}</p>
            </div>
          </DialogContent>
        )}
      </DialogRoot>
    </>
  );
}
