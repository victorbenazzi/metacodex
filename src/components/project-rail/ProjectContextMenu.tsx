import { type ReactNode } from "react";
import * as RCM from "@radix-ui/react-context-menu";
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Trash2,
  FolderOpen,
} from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { CMD, invoke } from "@/lib/ipc";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRoot,
  ContextMenuSeparator,
} from "@/components/ui/ContextMenu";
import { Icon } from "@/components/ui/Icon";
import { useProjectsStore } from "@/features/projects/project.store";
import type { Project } from "@/features/projects/project.types";

interface ProjectContextMenuProps {
  project: Project;
  children: ReactNode;
  onRequestRename: () => void;
  onRequestRemove: () => void;
}

export function ProjectContextMenu({
  project,
  children,
  onRequestRename,
  onRequestRemove,
}: ProjectContextMenuProps) {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const reorder = useProjectsStore((s) => s.reorder);

  // Keyboard-friendly alternative to drag-reorder: swap with the neighbor.
  const index = projects.findIndex((p) => p.id === project.id);
  const moveBy = (delta: number) => {
    const to = index + delta;
    if (index < 0 || to < 0 || to >= projects.length) return;
    const ids = projects.map((p) => p.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    void reorder(ids);
  };

  const revealInFinder = async () => {
    try {
      await invoke(CMD.revealInFinder, { path: project.path });
    } catch (e) {
      console.warn("reveal_in_finder failed", e);
    }
  };

  return (
    <ContextMenuRoot>
      <RCM.Trigger asChild>{children}</RCM.Trigger>
      <ContextMenuContent className="min-w-[224px]">
        <ContextMenuLabel>{project.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={onRequestRename}>
          <Icon icon={Pencil} size={12} className="text-muted" />
          {t("projectRail.menu.rename")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={revealInFinder}>
          <Icon icon={FolderOpen} size={12} className="text-muted" />
          {t("projectRail.menu.revealInFinder")}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem disabled={index <= 0} onSelect={() => moveBy(-1)}>
          <Icon icon={ArrowUp} size={12} className="text-muted" />
          {t("projectRail.menu.moveUp")}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={index < 0 || index >= projects.length - 1}
          onSelect={() => moveBy(1)}
        >
          <Icon icon={ArrowDown} size={12} className="text-muted" />
          {t("projectRail.menu.moveDown")}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem destructive onSelect={onRequestRemove}>
          <Icon icon={Trash2} size={12} />
          {t("projectRail.menu.removeFromApp")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
