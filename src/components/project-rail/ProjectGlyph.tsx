import { useMemo } from "react";

import { isCustomIcon } from "@/features/projects/customIcon.service";
import type { Project } from "@/features/projects/project.types";
import { lookupProjectGlyph, monogram } from "./projectIdentity";

/**
 * The project's icon at sidebar-row scale (no tile chrome). Inherits the
 * surrounding text color so it always reads in the default ink of its row.
 * Mirrors the rail tile's three render paths (custom favicon, picker glyph, or
 * typographic monogram) so the expanded sidebar reads the same project
 * identity as the collapsed rail.
 */
export function ProjectGlyph({ project, size = 16 }: { project: Project; size?: number }) {
  const usesCustom = isCustomIcon(project.icon);
  const Glyph = !usesCustom ? lookupProjectGlyph(project.icon) : null;
  const mark = useMemo(() => monogram(project.name), [project.name]);

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
      ) : Glyph ? (
        <Glyph size={size - 2} strokeWidth={1.8} />
      ) : (
        <span className="font-display leading-none" style={{ fontSize: size - 5 }}>
          {mark}
        </span>
      )}
    </span>
  );
}
