import { forwardRef, useMemo, useState, type ButtonHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";

import { Tooltip } from "@/components/ui/Tooltip";
import { statusTone } from "@/components/tabs/statusTone";
import { cn } from "@/lib/cn";
import { tileIconColor } from "@/features/projects/color";
import { isCustomIcon } from "@/features/projects/customIcon.service";
import { useThemeStore } from "@/features/theme/theme.store";
import { useProjectAgentStatus } from "@/features/terminal/projectStatus";
import type { Project } from "@/features/projects/project.types";
import { lookupLucide, monogram } from "./projectIdentity";
import { ProjectStatusDot } from "./ProjectStatusDot";

interface ProjectTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  project: Project;
  active: boolean;
  isDragging?: boolean;
}

/**
 * Project tile in the left rail. Three render paths in priority order:
 *  1. Custom favicon (data: URI chosen by the user): render the image.
 *  2. Lucide icon name from the project picker: render the icon.
 *  3. Neither: fall back to the typographic monogram (Fraunces display, upright).
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

  // Aggregated session status: a corner badge on the tile (decorative; the
  // tile's own tooltip carries the readable label, so we don't nest tooltips).
  const { status: aggStatus, urgency: aggUrgency, sessionCount } = useProjectAgentStatus(
    project.id,
  );
  const aggTone = aggStatus ? statusTone(aggStatus, aggUrgency) : null;

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-[2px]">
          <span className="font-medium">{project.name}</span>
          <span className="font-mono text-micro text-muted">{project.path}</span>
          {aggTone ? (
            <span className="font-mono text-micro text-muted">
              {t(aggTone.labelKey)} · {t("projectRail.sessions", { count: sessionCount })}
            </span>
          ) : null}
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
          "relative inline-flex h-[32px] w-[32px] items-center justify-center rounded-md border bg-surface-card",
          "hover:shadow-elevated",
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
            className="h-[18px] w-[18px] object-contain"
          />
        ) : LucideIcon ? (
          <LucideIcon
            size={16}
            strokeWidth={1.6}
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
            style={{ fontSize: mark.length > 1 ? "12px" : "15px" }}
          >
            {mark}
          </span>
        )}
        {active ? (
          <span
            aria-hidden
            className="absolute -left-[8px] top-1/2 h-[16px] w-[2px] -translate-y-1/2 rounded-pill bg-accent"
          />
        ) : null}
        {aggStatus ? (
          <span
            aria-hidden
            className="absolute -right-[3px] -top-[3px] grid place-items-center rounded-pill bg-canvas p-[2px]"
          >
            <ProjectStatusDot status={aggStatus} urgency={aggUrgency} />
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
});
