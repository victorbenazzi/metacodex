import { forwardRef, useMemo, useState, type ButtonHTMLAttributes } from "react";
import * as Lucide from "lucide-react";
import { useTranslation } from "react-i18next";

import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import { tileIconColor, tileMarkerColor } from "@/features/projects/color";
import { isCustomIcon } from "@/features/projects/customIcon.service";
import { useThemeStore } from "@/features/theme/theme.store";
import type { Project } from "@/features/projects/project.types";

interface ProjectTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  project: Project;
  active: boolean;
  isDragging?: boolean;
}

/** Resolve a Lucide icon name to its component. Returns null when the name
 *  doesn't match — the caller falls through to the typographic monogram. */
function lookupLucide(name: string): Lucide.LucideIcon | null {
  const I = (Lucide as unknown as Record<string, Lucide.LucideIcon>)[name];
  return I ?? null;
}

/** Initials shown when a project has no chosen icon. Two-word names take one
 *  letter per word; single-word names take just the first letter — the
 *  single-letter look is the editorial default. */
function monogram(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "·";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words[0] && words[1]) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return cleaned.slice(0, 1).toUpperCase();
}

/**
 * Project tile in the left rail. Three render paths in priority order:
 *  1. Custom favicon (data: URI chosen by the user) — render the image.
 *  2. Lucide icon name from the project picker — render the icon.
 *  3. Neither — fall back to the typographic monogram (Fraunces display, upright).
 * The tile itself is always neutral surface-card with a hairline border; the
 * project's accent hex tints the icon stroke / monogram color so the color
 * picker still has visible effect without painting the whole tile.
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
  const LucideIcon = !usesCustom ? lookupLucide(project.icon) : null;
  const mark = useMemo(() => monogram(project.name), [project.name]);
  const accent = tileIconColor(project.color, theme);
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
          "relative inline-flex h-[40px] w-[40px] items-center justify-center rounded-md border bg-surface-card transition-[border-color,background-color,color,opacity] duration-fast ease-out",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[3px]",
          active
            ? "border-hairline-strong"
            : hover
              ? "border-hairline-strong bg-surface-strong/30"
              : "border-hairline",
          isDragging && "opacity-40",
          className,
        )}
        style={active ? { color: accent } : undefined}
        {...rest}
      >
        {usesCustom ? (
          <img
            src={project.icon}
            alt=""
            draggable={false}
            className="h-[22px] w-[22px] object-contain"
          />
        ) : LucideIcon ? (
          <LucideIcon
            size={17}
            strokeWidth={1.7}
            color={active ? accent : undefined}
            className={active ? undefined : "text-muted"}
            aria-hidden
          />
        ) : (
          <span
            className={cn(
              "font-display leading-none transition-colors duration-fast",
              active ? "font-medium" : "text-muted",
            )}
            style={{ fontSize: mark.length > 1 ? "14px" : "18px" }}
          >
            {mark}
          </span>
        )}
        {active ? (
          <span
            aria-hidden
            className="absolute -left-[10px] top-1/2 h-[18px] w-[2px] -translate-y-1/2 rounded-pill"
            style={{ backgroundColor: markerColor }}
          />
        ) : null}
      </button>
    </Tooltip>
  );
});
