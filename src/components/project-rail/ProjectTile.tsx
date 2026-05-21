import { forwardRef, useMemo } from "react";
import * as Lucide from "lucide-react";

import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import type { Project } from "@/features/projects/project.types";

interface ProjectTileProps {
  project: Project;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/**
 * Convert a hex color to a translucent rgba background — keeps tiles quiet
 * while still showing the per-project identity color.
 */
function hexToRgba(hex: string, alpha: number): string {
  const v = hex.replace("#", "");
  const n = parseInt(v.length === 3 ? v.split("").map((c) => c + c).join("") : v, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getLucideIcon(name: string): Lucide.LucideIcon {
  const Icon = (Lucide as unknown as Record<string, Lucide.LucideIcon>)[name];
  return Icon ?? Lucide.Folder;
}

export const ProjectTile = forwardRef<HTMLButtonElement, ProjectTileProps>(function ProjectTile(
  { project, active, onClick, onContextMenu },
  ref,
) {
  const IconComponent = useMemo(() => getLucideIcon(project.icon), [project.icon]);

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-[2px]">
          <span className="font-medium">{project.name}</span>
          <span className="font-mono text-[10px] text-muted">{project.path}</span>
        </span>
      }
      side="right"
      align="center"
    >
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        aria-label={`Switch to ${project.name}`}
        aria-current={active ? "true" : undefined}
        className={cn(
          "relative inline-flex h-[36px] w-[36px] items-center justify-center rounded-md border transition-all duration-150 ease-out",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[3px]",
          active
            ? "border-ink/30 scale-100"
            : "border-hairline hover:border-hairline-strong hover:scale-[1.04]",
        )}
        style={{
          backgroundColor: hexToRgba(project.color, active ? 0.22 : 0.12),
        }}
      >
        <IconComponent
          size={15}
          strokeWidth={1.6}
          className={active ? "text-ink" : "text-body/85"}
          aria-hidden
        />
        {active ? (
          <span
            aria-hidden
            className="absolute -left-[10px] top-1/2 h-[16px] w-[2px] -translate-y-1/2 rounded-full bg-ink"
          />
        ) : null}
      </button>
    </Tooltip>
  );
});
