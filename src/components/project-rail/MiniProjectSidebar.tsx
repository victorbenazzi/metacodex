import { useState } from "react";
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

export function MiniProjectSidebar({ onOpenFolder }: MiniProjectSidebarProps) {
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const setActive = useProjectsStore((s) => s.setActive);
  const remove = useProjectsStore((s) => s.remove);

  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const settingsOpen = useSettingsStore((s) => s.open);
  const setSettingsOpen = useSettingsStore((s) => s.setOpen);

  return (
    <>
      <aside
        className="relative flex h-full w-full flex-col items-center border-r border-hairline bg-canvas-soft"
        aria-label="Project rail"
      >
        <div className="flex flex-1 flex-col items-center gap-[8px] overflow-y-auto overflow-x-hidden px-[8px] py-[14px]">
          {projects.map((p) => (
            <ProjectContextMenu
              key={p.id}
              project={p}
              onRequestRename={() => setRenameTarget(p)}
              onRequestRemove={() => setRemoveTarget(p)}
            >
              <ProjectTile
                project={p}
                active={p.id === activeProjectId}
                onClick={() => setActive(p.id)}
                onContextMenu={(e) => e.preventDefault() /* Radix handles via Trigger */}
              />
            </ProjectContextMenu>
          ))}
        </div>

        <div className="flex w-full flex-col items-center gap-[6px] border-t border-hairline-soft py-[10px]">
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
