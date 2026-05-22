import { forwardRef, useMemo, useState, type ButtonHTMLAttributes } from "react";
import * as Lucide from "lucide-react";
import { useTranslation } from "react-i18next";

import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import {
  tileBackground,
  tileBackgroundFavicon,
  tileIconColor,
  tileMarkerColor,
} from "@/features/projects/color";
import { isCustomIcon } from "@/features/projects/customIcon.service";
import { useThemeStore } from "@/features/theme/theme.store";
import type { Project } from "@/features/projects/project.types";

interface ProjectTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  project: Project;
  active: boolean;
  isDragging?: boolean;
}

function getLucideIcon(name: string): Lucide.LucideIcon {
  const Icon = (Lucide as unknown as Record<string, Lucide.LucideIcon>)[name];
  return Icon ?? Lucide.Folder;
}

/**
 * The tile is intentionally "transparent": every prop the parent (or Radix's
 * `Trigger asChild`) injects gets spread onto the underlying `<button>`. That
 * keeps context-menu / tooltip / drag handlers all flowing through a single
 * DOM element without wrappers swallowing events.
 */
export const ProjectTile = forwardRef<HTMLButtonElement, ProjectTileProps>(function ProjectTile(
  {
    project,
    active,
    isDragging,
    className,
    onMouseEnter,
    onMouseLeave,
    ...rest
  },
  ref,
) {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.effective);
  const [hover, setHover] = useState(false);

  const usesCustom = isCustomIcon(project.icon);
  const FallbackIcon = useMemo(
    () => (usesCustom ? Lucide.Folder : getLucideIcon(project.icon)),
    [project.icon, usesCustom],
  );

  const bg = usesCustom
    ? tileBackgroundFavicon(project.color, { theme, active, hover })
    : tileBackground(project.color, { theme, active, hover });
  const iconColor = tileIconColor(project.color, theme);
  const markerColor = tileMarkerColor(theme);

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
        onMouseEnter={(e) => {
          setHover(true);
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          setHover(false);
          onMouseLeave?.(e);
        }}
        aria-label={t("projectRail.switchTo", { name: project.name })}
        aria-current={active ? "true" : undefined}
        className={cn(
          "relative inline-flex h-[36px] w-[36px] items-center justify-center rounded-md border transition-[background-color,border-color,opacity] duration-150 ease-out",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[3px]",
          active
            ? "border-ink/25"
            : "border-hairline hover:border-hairline-strong",
          isDragging && "opacity-40",
          className,
        )}
        style={{
          backgroundColor: bg,
        }}
        {...rest}
      >
        {usesCustom ? (
          <img
            src={project.icon}
            alt=""
            draggable={false}
            className="h-[18px] w-[18px] object-contain"
          />
        ) : (
          <FallbackIcon
            size={15}
            strokeWidth={1.7}
            color={iconColor}
            aria-hidden
          />
        )}
        {active ? (
          <span
            aria-hidden
            className="absolute -left-[10px] top-1/2 h-[16px] w-[2px] -translate-y-1/2 rounded-full"
            style={{ backgroundColor: markerColor }}
          />
        ) : null}
      </button>
    </Tooltip>
  );
});
