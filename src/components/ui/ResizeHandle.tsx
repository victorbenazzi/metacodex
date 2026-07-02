import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

type Side = "left" | "right" | "center";

interface ResizeHandleProps {
  /** Current value the handle controls (px or ratio — caller's choice). */
  value: number;
  /** Lower bound (inclusive) for the controlled value. */
  min: number;
  /** Upper bound (inclusive) for the controlled value. */
  max: number;
  /** Convert a pointer-delta in px to a delta in the value's unit. Identity for
   *  px-based widths; for a 0–1 ratio it's `dx / containerWidth`. */
  toDelta: (dxPx: number) => number;
  /**
   * Where the 1px rail sits within the 8px hit zone:
   *   - "left"   — rail on the LEFT edge of the hit zone. Use when the handle
   *                lives on the LEFT edge of the panel it sizes (the source-
   *                control panel's leading edge).
   *   - "right"  — rail on the RIGHT edge. Use for handles on the RIGHT edge
   *                of a panel (the explorer panel's trailing edge).
   *   - "center" — rail centered within the hit zone. Use when the handle
   *                free-floats over a parent that's not its own panel (the
   *                diff-split seam between two editors).
   */
  side: Side;
  /** Called continuously during drag with the clamped next value. */
  onChange: (next: number) => void;
  /** Called on double-click to restore the default value. */
  onReset?: () => void;
  /**
   * Extra classes for the root hit-zone div. Reserved for layout overrides
   * needed by callers that position the handle themselves (see `style`).
   */
  className?: string;
  /**
   * Style overrides for the root hit-zone div. Use when the handle needs to
   * be positioned by the caller (e.g. anchored to a CSS variable percentage
   * for the diff split). When set, the default edge offsets (-4px from left/
   * right of the parent) are suppressed via `position` overrides.
   */
  style?: React.CSSProperties;
  /** Optional aria label for screen readers. */
  ariaLabel?: string;
  /** When false, hides the handle entirely (e.g. panel collapsed). */
  enabled?: boolean;
}

/**
 * Minimal panel resize affordance.
 *
 * Visual language:
 *   - The handle's hit zone is 8px wide; only a 1px rail is ever painted.
 *   - Resting state: transparent (no visual noise, no extra hairline next to
 *     the panel's own border).
 *   - Hover: rail brightens to `--hairline-strong`.
 *   - Active drag: rail darkens to `--primary` and the page cursor is forced
 *     to `col-resize` so the user keeps grabbing it even when the pointer
 *     drifts outside the 8px zone.
 *   - Double-click: restores the default value.
 *
 * No backdrop blur, no shadow, no scale — opacity-only fade per the project's
 * popup-motion rule. Color transition is 150ms ease-out.
 */
export function ResizeHandle({
  value,
  min,
  max,
  toDelta,
  side,
  onChange,
  onReset,
  className,
  style,
  ariaLabel,
  enabled = true,
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  // Latest controlled value, captured at drag-start. Reading from state in the
  // pointermove handler would close over the value at drag-start time only.
  const startRef = useRef({ pointerPx: 0, value: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      startRef.current = { pointerPx: e.clientX, value };
      setDragging(true);
    },
    [enabled, value],
  );

  // Global pointer tracking while dragging — listening on `window` (capture)
  // means we keep getting updates even if the pointer leaves the 8px hit zone
  // or hovers over an iframe / xterm canvas.
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const dxPx = e.clientX - startRef.current.pointerPx;
      // Caller decides direction & unit conversion. For panels on the right
      // (source control), dragging right SHRINKS the panel — they invert in
      // `toDelta`.
      const delta = toDelta(dxPx);
      const next = clamp(startRef.current.value + delta, min, max);
      onChange(next);
    };

    const stop = () => setDragging(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    // While dragging force the cursor globally (xterm/CodeMirror set their own
    // cursors inside their canvases) and block text selection.
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging, max, min, onChange, toDelta]);

  const onDoubleClick = useCallback(() => {
    if (onReset) onReset();
  }, [onReset]);

  if (!enabled) return null;

  // Default edge offsets (-4px) put the 8px hit zone half-inside and half-
  // outside the panel border. Callers that supply their own `style` (e.g.
  // free-floating diff seam) skip these by overriding the offset properties.
  const defaultEdgeClass =
    side === "right" ? "-right-[4px]" : side === "left" ? "-left-[4px]" : "";

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={cn(
        "group absolute top-0 z-30 h-full w-[8px] touch-none select-none cursor-col-resize",
        defaultEdgeClass,
        className,
      )}
      style={style}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0 h-full w-px",
          side === "right"
            ? "right-0"
            : side === "left"
              ? "left-0"
              : // center: position rail at the geometric middle of the 8px hit
                // zone (left: 50%, translateX(-50%) below).
                "left-1/2 -translate-x-1/2",
          "transition-colors duration-fast ease-out",
          dragging
            ? "bg-primary"
            : hovering
              ? "bg-hairline-strong"
              : "bg-transparent",
        )}
      />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
