import { useEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from "react";

/**
 * Pointer-driven drag-to-reorder for a vertical list. Canonical gesture shared
 * by the project rail (tiles) and the expanded projects sidebar (rows): the
 * hook owns press → threshold → drag, drop-slot math, click suppression and
 * the global grabbing cursor; each surface renders its own ghost and uses
 * `ReorderDropLine` for the insertion indicator.
 *
 * Consumer contract:
 *  - The scroll container must be `position: relative` and be the offsetParent
 *    of every item wrapper (`indicatorTop` is in its coordinate space, so the
 *    indicator scrolls with the content).
 *  - Attach `itemRef(id)` and spread `getItemProps(id)` on each item wrapper,
 *    with `touch-action: none` so vertical drags aren't eaten by scroll.
 *  - Interactive descendants that must never start a drag (menu triggers,
 *    nested rows) opt out with a `data-no-drag` attribute.
 *
 * WKWebView note (do not "fix"): we intentionally do NOT setPointerCapture.
 * Capturing on the wrapper suppresses the nested button's click event under
 * composed Radix Slots (see the "Drag = pointer events" memory); window-level
 * listeners track the gesture fine without capture.
 */

// Minimum pointer travel before a press becomes a drag. Below this, the press
// is treated as a click. 8px absorbs the small pointer oscillation a MacBook
// trackpad emits during a deliberate tap — at 4px those taps were silently
// flipping into "drag" mode and suppressing the click, which read as
// "I can't switch projects" for trackpad users.
const DRAG_THRESHOLD_PX = 8;

// After a drag ends (or a pointerup activation fires), the browser still
// dispatches a trailing click on the pressed element; swallow it inside this
// window. Genuine keyboard clicks (Enter/Space) have no recent pointer
// activity and pass through.
const CLICK_SUPPRESS_MS = 250;

// Indicator distance from the first/last item when dropping at the edges;
// interior slots center in the real gap between neighbors.
const EDGE_GAP_PX = 4;

export interface ListReorderHandle {
  /** Item currently being dragged (drives dim-in-place + the surface ghost). */
  draggingId: string | null;
  /** Viewport pointer position while dragging; anchors the surface's ghost. */
  pointerPos: { x: number; y: number } | null;
  /** Center Y (px, container space) for the drop indicator; null = hidden. */
  indicatorTop: number | null;
  itemRef: (id: string) => (el: HTMLElement | null) => void;
  getItemProps: (id: string) => {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => void;
    onClickCapture: (e: RMouseEvent<HTMLElement>) => void;
  };
}

export function useListReorder({
  ids,
  onReorder,
  onPressActivate,
}: {
  ids: string[];
  onReorder: (orderedIds: string[]) => void;
  /**
   * Optional pointerup-without-drag activation, for surfaces whose nested
   * button click is unreliable under WKWebView (the rail tile is asChild'd by
   * TooltipTrigger + ContextMenuTrigger, a known click-swallowing combo).
   */
  onPressActivate?: (id: string) => void;
}): ListReorderHandle {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);

  // One DOM ref per item wrapper: drop-slot math + indicator geometry.
  const itemEls = useRef<Map<string, HTMLElement>>(new Map());
  const itemRef = (id: string) => (el: HTMLElement | null) => {
    if (el) itemEls.current.set(id, el);
    else itemEls.current.delete(id);
  };

  const suppressClicksUntil = useRef(0);

  // Handlers are registered at pointerdown time; read order/callbacks through
  // refs so a re-render mid-gesture can't act on a stale list.
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onPressActivateRef = useRef(onPressActivate);
  onPressActivateRef.current = onPressActivate;

  // Global cursor while dragging — a body class so EVERY element (including
  // buttons that opt into cursor:pointer) shows the grabbing cursor.
  useEffect(() => {
    if (!draggingId) return;
    document.body.classList.add("is-reordering-projects");
    return () => {
      document.body.classList.remove("is-reordering-projects");
    };
  }, [draggingId]);

  const computeDropIndex = (clientY: number): number => {
    // Walk visible items top-down; the first one whose midpoint sits below the
    // pointer is the insertion slot. Falling past all of them means "append".
    const order = idsRef.current;
    for (let i = 0; i < order.length; i++) {
      const el = itemEls.current.get(order[i]);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return order.length;
  };

  const onPointerDown = (id: string) => (e: RPointerEvent<HTMLElement>) => {
    // Only left-button presses initiate drag. Right-click falls through to the
    // context menu trigger; middle/etc. are ignored.
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // Skip presses on open menus and on descendants that opted out of drag.
    if (target?.closest("[role=menu],[data-no-drag]")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let localDropIndex: number | null = null;

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        setDraggingId(id);
      }
      const idx = computeDropIndex(ev.clientY);
      localDropIndex = idx;
      setDropIndex(idx);
      setPointerPos({ x: ev.clientX, y: ev.clientY });
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setDraggingId(null);
      setDropIndex(null);
      setPointerPos(null);
    };

    const onUp = () => {
      if (dragging && localDropIndex != null) {
        const order = idsRef.current;
        const sourceIdx = order.indexOf(id);
        // Drops at the source's own slots (`i` and `i+1`) are no-ops; skip.
        if (sourceIdx >= 0 && localDropIndex !== sourceIdx && localDropIndex !== sourceIdx + 1) {
          const next = [...order];
          next.splice(sourceIdx, 1);
          const insertAt = localDropIndex > sourceIdx ? localDropIndex - 1 : localDropIndex;
          next.splice(insertAt, 0, id);
          onReorderRef.current(next);
        }
        suppressClicksUntil.current = performance.now() + CLICK_SUPPRESS_MS;
      } else if (!dragging && onPressActivateRef.current) {
        // Activate from pointerup so the project switches even when the child
        // button's click never arrives; the suppression window below swallows
        // the click when it DOES arrive, preventing a double activation.
        suppressClicksUntil.current = performance.now() + CLICK_SUPPRESS_MS;
        onPressActivateRef.current(id);
      }
      cleanup();
    };

    const onCancel = () => cleanup();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const onClickCapture = (e: RMouseEvent<HTMLElement>) => {
    if (performance.now() < suppressClicksUntil.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const getItemProps = (id: string) => ({
    onPointerDown: onPointerDown(id),
    onClickCapture,
  });

  // Indicator geometry, in the container's offset space. Hidden on the two
  // slots adjacent to the source item (dropping there is a no-op and the line
  // would be misleading).
  const sourceIdx = draggingId ? ids.indexOf(draggingId) : -1;
  let indicatorTop: number | null = null;
  if (
    draggingId !== null &&
    dropIndex !== null &&
    dropIndex !== sourceIdx &&
    dropIndex !== sourceIdx + 1 &&
    ids.length > 0
  ) {
    if (dropIndex >= ids.length) {
      const el = itemEls.current.get(ids[ids.length - 1]);
      if (el) indicatorTop = el.offsetTop + el.offsetHeight + EDGE_GAP_PX;
    } else if (dropIndex === 0) {
      const el = itemEls.current.get(ids[0]);
      if (el) indicatorTop = el.offsetTop - EDGE_GAP_PX;
    } else {
      const prev = itemEls.current.get(ids[dropIndex - 1]);
      const next = itemEls.current.get(ids[dropIndex]);
      if (prev && next) {
        indicatorTop = (prev.offsetTop + prev.offsetHeight + next.offsetTop) / 2;
      } else if (next) {
        indicatorTop = next.offsetTop - EDGE_GAP_PX;
      }
    }
  }

  return { draggingId, pointerPos, indicatorTop, itemRef, getItemProps };
}

/**
 * Insertion indicator for a reorder drag: a 2px rule bookended by two dot caps
 * so the line reads as deliberate against any item color. Positioned in the
 * container's flow (the container must be `relative`), centered on `top`, so
 * surrounding items never reflow as the pointer moves between gaps.
 */
export function ReorderDropLine({ top, insetX = 6 }: { top: number; insetX?: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute z-10 flex -translate-y-1/2 items-center"
      style={{ top: `${top}px`, left: `${insetX}px`, right: `${insetX}px`, height: "3px" }}
    >
      <span className="-ml-[1px] h-[6px] w-[6px] rounded-pill bg-ink" />
      <span className="h-[2px] flex-1 bg-ink" />
      <span className="-mr-[1px] h-[6px] w-[6px] rounded-pill bg-ink" />
    </span>
  );
}
