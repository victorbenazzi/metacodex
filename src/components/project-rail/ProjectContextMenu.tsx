import { useEffect, useState, type ReactNode } from "react";
import * as RCM from "@radix-ui/react-context-menu";
import { Pencil, Trash2, Paintbrush, FolderOpen, Shapes, Image as ImageIcon } from "lucide-react";

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
import { useThemeStore } from "@/features/theme/theme.store";
import {
  tileBackground,
  tileIconColor,
} from "@/features/projects/color";
import {
  PROJECT_PALETTE,
  PROJECT_ICONS,
  type Project,
} from "@/features/projects/project.types";
import {
  faviconApi,
  toFaviconIcon,
  type FaviconCandidate,
} from "@/features/projects/favicon.service";
import { useFaviconDataUri } from "@/features/projects/useFaviconDataUri";
import { cn } from "@/lib/cn";

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
  const [favicons, setFavicons] = useState<FaviconCandidate[]>([]);

  // Detect favicons whenever the project changes. Errors are silent — a
  // missing favicon is a normal state and we just show no extra section.
  useEffect(() => {
    let cancelled = false;
    faviconApi
      .detect(project.id)
      .then((res) => {
        if (!cancelled) setFavicons(res);
      })
      .catch(() => {
        if (!cancelled) setFavicons([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, project.path]);

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
              <span
                aria-hidden
                className="ml-[6px] inline-block h-[10px] w-[10px] rounded-full border border-hairline"
                style={{ backgroundColor: project.color }}
              />
            </>
          }
        >
          <div className="grid grid-cols-4 gap-[8px] p-[10px]">
            {PROJECT_PALETTE.map((entry) => (
              <SwatchButton
                key={entry.hex}
                color={entry.hex}
                selected={project.color === entry.hex}
                onClick={() => updateMeta(project.id, { color: entry.hex })}
              />
            ))}
          </div>
        </ContextMenuSub>

        <ContextMenuSub
          trigger={
            <>
              <Icon icon={Shapes} size={12} className="text-muted" />
              <span>Icon</span>
            </>
          }
        >
          <div className="max-h-[300px] overflow-y-auto p-[8px]">
            {favicons.length > 0 ? (
              <>
                <div className="editorial-caps flex items-center gap-[6px] px-[2px] pb-[6px] text-muted">
                  <Icon icon={ImageIcon} size={10} />
                  From this project
                </div>
                <div className="grid grid-cols-5 gap-[6px]">
                  {favicons.map((c) => {
                    const value = toFaviconIcon(c.path);
                    return (
                      <FaviconChoice
                        key={c.path}
                        candidate={c}
                        color={project.color}
                        selected={project.icon === value}
                        onClick={() => updateMeta(project.id, { icon: value })}
                      />
                    );
                  })}
                </div>
                <div className="my-[8px] h-px bg-hairline-soft" />
              </>
            ) : null}
            <div className="grid grid-cols-5 gap-[6px]">
              {PROJECT_ICONS.map((name) => (
                <IconChoice
                  key={name}
                  name={name}
                  color={project.color}
                  selected={project.icon === name}
                  onClick={() => updateMeta(project.id, { icon: name })}
                />
              ))}
            </div>
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
  const theme = useThemeStore((s) => s.effective);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Use color ${color}`}
      aria-pressed={selected}
      className="relative inline-flex h-[28px] w-[28px] items-center justify-center rounded-md transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[3px]"
      style={{
        backgroundColor: tileBackground(color, {
          theme,
          active: selected,
          hover: false,
        }),
        boxShadow: selected
          ? `0 0 0 2px var(--surface-card), 0 0 0 4px ${color}`
          : "inset 0 0 0 1px var(--hairline)",
      }}
    >
      <span
        aria-hidden
        className="h-[14px] w-[14px] rounded-full"
        style={{ backgroundColor: color }}
      />
    </button>
  );
}

function IconChoice({
  name,
  color,
  selected,
  onClick,
}: {
  name: string;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  const theme = useThemeStore((s) => s.effective);
  return (
    <LazyIcon
      name={name}
      selected={selected}
      onClick={onClick}
      iconColor={tileIconColor(color, theme)}
      ringColor={color}
      tintBg={tileBackground(color, { theme, active: selected, hover: false })}
    />
  );
}

function LazyIcon({
  name,
  iconColor,
  tintBg,
  ringColor,
  selected,
  onClick,
}: {
  name: string;
  iconColor: string;
  tintBg: string;
  ringColor: string;
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
      className={cn(
        "flex h-[30px] w-[30px] items-center justify-center rounded-sm transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
        !selected && "hover:bg-surface-strong/40",
      )}
      style={{
        backgroundColor: selected ? tintBg : "transparent",
        boxShadow: selected ? `0 0 0 1.5px ${ringColor}` : undefined,
      }}
    >
      {Comp ? (
        <Comp
          size={14}
          strokeWidth={1.7}
          color={selected ? iconColor : "var(--body)"}
        />
      ) : (
        <span className="h-[14px] w-[14px]" />
      )}
    </button>
  );
}

function FaviconChoice({
  candidate,
  color,
  selected,
  onClick,
}: {
  candidate: FaviconCandidate;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  const uri = useFaviconDataUri(candidate.path);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Use favicon ${candidate.relPath}`}
      aria-pressed={selected}
      title={candidate.relPath}
      className={cn(
        "flex h-[30px] w-[30px] items-center justify-center rounded-sm transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
        !selected && "hover:bg-surface-strong/40",
      )}
      style={{
        boxShadow: selected ? `0 0 0 1.5px ${color}` : undefined,
      }}
    >
      {uri ? (
        <img
          src={uri}
          alt=""
          draggable={false}
          className="h-[18px] w-[18px] object-contain"
        />
      ) : (
        <span className="h-[18px] w-[18px] animate-pulse rounded-xs bg-surface-strong/60" />
      )}
    </button>
  );
}
