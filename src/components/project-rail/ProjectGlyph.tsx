import { useMemo } from "react";

import { tileIconColor } from "@/features/projects/color";
import { isCustomIcon } from "@/features/projects/customIcon.service";
import { useThemeStore } from "@/features/theme/theme.store";
import type { Project } from "@/features/projects/project.types";
import { lookupLucide, monogram } from "./projectIdentity";

/**
 * The project's icon at sidebar-row scale (no tile chrome), tinted by the
 * project color. Mirrors the rail tile's three render paths (custom favicon,
 * Lucide icon, or typographic monogram) so the expanded sidebar reads the same
 * project identity as the collapsed rail.
 */
export function ProjectGlyph({ project, size = 16 }: { project: Project; size?: number }) {
  const theme = useThemeStore((s) => s.effective);
  const usesCustom = isCustomIcon(project.icon);
  const LucideIcon = !usesCustom ? lookupLucide(project.icon) : null;
  const mark = useMemo(() => monogram(project.name), [project.name]);
  const color = tileIconColor(project.color, theme);

  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      {usesCustom ? (
        <img
          src={project.icon}
          alt=""
          draggable={false}
          className="object-contain"
          style={{ width: size - 2, height: size - 2 }}
        />
      ) : LucideIcon ? (
        <LucideIcon size={size - 2} strokeWidth={1.8} color={color} />
      ) : (
        <span className="font-display leading-none" style={{ fontSize: size - 5, color }}>
          {mark}
        </span>
      )}
    </span>
  );
}
