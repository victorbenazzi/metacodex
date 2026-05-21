import { useEffect, useState, type ReactNode } from "react";
import * as RCM from "@radix-ui/react-context-menu";
import { Pencil, Trash2, Paintbrush, FolderOpen } from "lucide-react";

import { CMD, invoke } from "@/lib/ipc";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
} from "@/components/ui/ContextMenu";
import { Icon } from "@/components/ui/Icon";
import { useProjectsStore } from "@/features/projects/project.store";
import { PROJECT_PALETTE, PROJECT_ICONS, type Project } from "@/features/projects/project.types";

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
  const updateMeta = useProjectsStore((s) => s.updateMeta);

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
      <ContextMenuContent>
        <ContextMenuLabel>{project.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={onRequestRename}>
          <Icon icon={Pencil} size={12} className="text-muted" />
          Rename in metacodex…
        </ContextMenuItem>
        <ContextMenuItem onSelect={revealInFinder}>
          <Icon icon={FolderOpen} size={12} className="text-muted" />
          Reveal in Finder
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub
          trigger={
            <>
              <Icon icon={Paintbrush} size={12} className="text-muted" />
              <span>Color</span>
            </>
          }
        >
          <div className="grid grid-cols-4 gap-[6px] p-[8px]">
            {PROJECT_PALETTE.map((c) => (
              <SwatchButton
                key={c}
                color={c}
                selected={project.color === c}
                onClick={() => updateMeta(project.id, { color: c })}
              />
            ))}
          </div>
        </ContextMenuSub>

        <ContextMenuSub
          trigger={
            <>
              <Icon icon={Pencil} size={12} className="text-muted" />
              <span>Icon</span>
            </>
          }
        >
          <div className="grid max-h-[260px] grid-cols-4 gap-[2px] overflow-y-auto p-[6px]">
            {PROJECT_ICONS.map((name) => (
              <IconChoice
                key={name}
                name={name}
                selected={project.icon === name}
                onClick={() => updateMeta(project.id, { icon: name })}
              />
            ))}
          </div>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem destructive onSelect={onRequestRemove}>
          <Icon icon={Trash2} size={12} />
          Remove from metacodex
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}

function SwatchButton({
  color,
  selected,
  onClick,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Use color ${color}`}
      aria-pressed={selected}
      className="relative h-[26px] w-[26px] rounded-sm border border-hairline transition-transform hover:scale-105"
      style={{ backgroundColor: color }}
    >
      {selected ? (
        <span className="absolute inset-[3px] rounded-xs border-2 border-on-primary" />
      ) : null}
    </button>
  );
}

function IconChoice({
  name,
  selected,
  onClick,
}: {
  name: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <LazyIcon
      name={name}
      selected={selected}
      onClick={onClick}
      className={
        selected
          ? "bg-surface-strong/80 text-ink"
          : "text-body hover:bg-surface-strong/40 hover:text-ink"
      }
    />
  );
}

// Tiny wrapper to lazily resolve a lucide icon by name so we don't import every icon eagerly.
function LazyIcon({
  name,
  className,
  selected,
  onClick,
}: {
  name: string;
  className: string;
  selected: boolean;
  onClick: () => void;
}) {
  const [Comp, setComp] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    import("lucide-react").then((m) => {
      if (cancelled) return;
      const C = (m as any)[name] ?? m.Folder;
      setComp(() => C);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Use icon ${name}`}
      aria-pressed={selected}
      className={`flex h-[28px] w-[28px] items-center justify-center rounded-sm transition-colors ${className}`}
    >
      {Comp ? <Comp size={14} strokeWidth={1.6} /> : <span className="h-[14px] w-[14px]" />}
    </button>
  );
}
