import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

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
   * Which panel edge the handle sits on. The hit zone straddles the 1px
   * hairline (half inside the panel, half into the neighbor) so aiming at
   * the visible border works from either side:
   *   - "left"   — leading edge of the panel (right workbench).
   *   - "right"  — trailing edge of the panel (projects sidebar).
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
   * for the diff split). When set, the default edge offsets (half the hit
   * zone hanging outside the parent) are suppressed via `position` overrides.
   */
  style?: CSSProperties;
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
 *   - Hit zone is `--resize-handle-w` (6px), centered on the panel hairline.
 *   - Resting state: transparent (the panel's own 1px border is the seam).
 *   - Hover: 2px rail at `--hairline-strong`, one pixel thicker than rest.
 *   - Active drag: 2px rail at `--primary` and the page cursor is forced
 *     to `col-resize` so the user keeps grabbing it even when the pointer
 *     drifts outside the hit zone.
 *   - Double-click: restores the default value.
 *
 * No backdrop blur, no shadow, no scale: opacity-only fade per the project's
 * popup-motion rule.
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
      // Double-click restores the default width. Handle it on pointerdown
      // (`detail`) because preventDefault on the first click can swallow the
      // subsequent `dblclick` in WKWebView.
      if (e.detail >= 2) {
        e.preventDefault();
        e.stopPropagation();
        onReset?.();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      startRef.current = { pointerPx: e.clientX, value };
      setDragging(true);
    },
    [enabled, onReset, value],
  );

  // Global pointer tracking while dragging. Listening on `window` (capture)
  // means we keep getting updates even if the pointer leaves the hit zone
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

  // Default edge offsets straddle the panel hairline: half the hit zone sits
  // inside the panel, half into the neighbor. Callers that supply their own
  // `style` (e.g. free-floating diff seam) skip these by overriding the offset.
  const edgeStyle: CSSProperties =
    side === "right"
      ? { right: "calc(var(--resize-handle-w) / -2)" }
      : side === "left"
        ? { left: "calc(var(--resize-handle-w) / -2)" }
        : {};
  const railActive = dragging || hovering;

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
        "group absolute top-0 z-30 h-full w-[var(--resize-handle-w)] touch-none select-none cursor-col-resize",
        className,
      )}
      style={{ ...edgeStyle, ...style }}
    >
      <span
        aria-hidden
        className={cn(
          // Rail sits on the hairline (hit-zone center). 1px at rest, 2px on
          // hover/drag so the seam reads as a slightly thicker Cursor-style
          // sash without a chunky grabber.
          "pointer-events-none absolute left-1/2 top-0 h-full -translate-x-1/2",
          "transition-[background-color,width] duration-fast ease-out",
          railActive ? "w-[2px]" : "w-px",
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
