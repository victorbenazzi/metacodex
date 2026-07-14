import { useTranslation } from "react-i18next";

import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

interface ExplorerTogglePillProps {
  /** Current state of the explorer column the pill controls. */
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Drawer toggle for the file-explorer column: a 3x40px pill sitting on the
 * panel seam.
 *
 * Two reveal modes, one component:
 *   - Expanded (rendered inside the ResizeHandle hit zone): invisible at rest,
 *     fades in when the explorer column is hovered (`group-hover/explorer`).
 *     Pointer events stay off until the explorer is hovered so the invisible
 *     button never swallows clicks meant for content next to the border.
 *   - Collapsed (rendered standalone, the handle is gone): faintly visible as
 *     the only way back, full strength on hover.
 *
 * Motion: opacity-only reveal (popup-motion rule); hover stretches the pill
 * (scaleY) and press compresses it, transform-only so nothing reflows.
 */
export function ExplorerTogglePill({ collapsed, onToggle }: ExplorerTogglePillProps) {
  const { t } = useTranslation();
  const label = collapsed ? t("explorer.expand") : t("explorer.collapse");

  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        aria-label={label}
        aria-expanded={!collapsed}
        onClick={onToggle}
        // Keep the press from reaching the resize handle underneath: a click
        // must toggle, never start a drag or trigger the double-click reset.
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className={cn(
          "group/pill absolute top-1/2 z-10 -translate-y-1/2",
          "flex h-[56px] w-[16px] cursor-pointer items-center justify-center",
          "transition-opacity duration-fast ease-out motion-reduce:transition-none",
          "focus-visible:outline-none",
          collapsed
            ? cn(
                // Standalone on the seam: center on the panel border.
                "left-1/2 -translate-x-1/2",
                "pointer-events-auto opacity-80 hover:opacity-100 focus-visible:opacity-100",
              )
            : cn(
                // Inside the handle: the hit zone hangs off the card's right
                // edge, so its LEFT edge is the card border. Straddle the pill
                // there, matching where the resize rail paints.
                "left-0 -translate-x-1/2",
                "pointer-events-none opacity-0",
                "group-hover/explorer:pointer-events-auto group-hover/explorer:opacity-100",
                "focus-visible:pointer-events-auto focus-visible:opacity-100",
              ),
        )}
      >
        <span
          aria-hidden
          className={cn(
            "h-[40px] w-[3px] rounded-pill bg-muted",
            "transition-[transform,background-color] duration-fast ease-out",
            "motion-reduce:transition-none motion-reduce:transform-none",
            "group-hover/pill:scale-y-110 group-hover/pill:bg-ink",
            "group-active/pill:scale-y-90 group-active/pill:bg-ink",
            "group-focus-visible/pill:bg-ink group-focus-visible/pill:ring-1 group-focus-visible/pill:ring-hairline-strong",
          )}
        />
      </button>
    </Tooltip>
  );
}
