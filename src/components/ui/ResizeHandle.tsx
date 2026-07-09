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
   * Which panel edge the handle sits on. In the floating-panel shell the
   * panels are separated by an 8px gap column; the hit zone occupies that gap
   * entirely and the 1px rail paints at the gap's midpoint:
   *   - "left"   — handle in the gap BEFORE the panel it sizes (the side
   *                panel's leading edge).
   *   - "right"  — handle in the gap AFTER a panel (the explorer card's
   *                trailing edge).
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
  /**
   * Notified when a drag starts (`true`) and ends (`false`). The shell uses it
   * to suspend its grid-template-columns transition during a drag, so 1px
   * resize steps track the pointer instead of easing behind it.
   */
  onDraggingChange?: (dragging: boolean) => void;
  /**
   * Optional affordances layered inside the hit zone (e.g. the explorer's
   * collapse pill). The root carries the `group` class so children can reveal
   * themselves via `group-hover:*`. Children are unmounted while dragging so
   * a resize gesture can never end on top of (and activate) one of them.
   */
  children?: React.ReactNode;
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
  onDraggingChange,
  children,
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

  // Report drag start/stop to the caller. In an effect (not inside the setters)
  // so it fires once per real transition and never during render.
  useEffect(() => {
    onDraggingChange?.(dragging);
  }, [dragging, onDraggingChange]);

  const onDoubleClick = useCallback(() => {
    if (onReset) onReset();
  }, [onReset]);

  if (!enabled) return null;

  // Default edge offsets (-8px) hang the 8px hit zone fully outside the panel,
  // covering the gap column between two floating cards. Callers that supply
  // their own `style` (e.g. free-floating diff seam) skip these by overriding
  // the offset properties.
  const defaultEdgeClass =
    side === "right" ? "-right-[8px]" : side === "left" ? "-left-[8px]" : "";

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
          // The hit zone spans the whole gap between two cards; the rail
          // paints ON the sized panel's edge (overlaying its 1px border) so
          // hover/drag reads as the card border lighting up, never a loose
          // line floating in the gap. It is inset 12px (the card radius) from
          // both ends so it hugs only the straight run of the edge. "center"
          // (diff seam) has no card edge, so it stays at the zone's middle.
          "pointer-events-none absolute w-px",
          side === "right"
            ? "-left-px bottom-[12px] top-[12px]"
            : side === "left"
              ? "-right-px bottom-[12px] top-[12px]"
              : "left-1/2 top-0 h-full -translate-x-1/2",
          "transition-colors duration-fast ease-out",
          dragging
            ? "bg-primary"
            : hovering
              ? "bg-hairline-strong"
              : "bg-transparent",
        )}
      />
      {dragging ? null : children}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
