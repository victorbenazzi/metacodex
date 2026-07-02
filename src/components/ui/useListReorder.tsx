import { useEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from "react";

/**
 * Pointer-driven drag-to-reorder for a list along one axis. Canonical gesture
 * shared by the project rail, the expanded projects sidebar (both `axis: "y"`)
 * and the tab bar (`axis: "x"`): the hook owns press → threshold → drag,
 * drop-slot math, click suppression, Escape-to-cancel, optional edge
 * auto-scroll and the global grabbing cursor; each surface renders its own
 * ghost and indicator (`ReorderDropLine` is the vertical-list convenience).
 *
 * Consumer contract:
 *  - Attach `itemRef(id)` and spread `getItemProps(id)` on each item wrapper,
 *    with `touch-action: none` so drags aren't eaten by scroll.
 *  - For `indicatorTop` (y axis): the scroll container must be
 *    `position: relative` and the offsetParent of every item (the indicator
 *    scrolls with the content). X-axis consumers read `dropIndex` +
 *    `getItemEl` and own their indicator geometry (the tab bar compensates
 *    `scrollLeft` and renders outside the scroll container on purpose).
 *  - Interactive descendants that must never start a drag (menu triggers,
 *    nested rows, close buttons) opt out with a `data-no-drag` attribute.
 *
 * WKWebView note (do not "fix"): we intentionally do NOT setPointerCapture.
 * Capturing on the wrapper suppresses the nested button's click event under
 * composed Radix Slots (see the "Drag = pointer events" memory); window-level
 * listeners track the gesture fine without capture.
 */

// Minimum pointer travel before a press becomes a drag. Below this, the press
// is treated as a click. 8px absorbs the small pointer oscillation a MacBook
// trackpad emits during a deliberate tap; consumers with tighter tuning (the
// tab bar uses 6) override via `thresholdPx`.
const DEFAULT_THRESHOLD_PX = 8;

// After a drag ends (or a pointerup activation fires), the browser still
// dispatches a trailing click on the pressed element; swallow it inside this
// window. Genuine keyboard clicks (Enter/Space) have no recent pointer
// activity and pass through. Self-expiring, so a drop over a DIFFERENT item
// (whose click lands elsewhere) can never leave a stale suppression armed.
const CLICK_SUPPRESS_MS = 250;

// Indicator distance from the first/last item when dropping at the edges;
// interior slots center in the real gap between neighbors. (y axis only.)
const EDGE_GAP_PX = 4;

// Auto-scroll defaults: band width at each container edge and the max scroll
// delta applied per animation frame at the very edge.
const DEFAULT_AUTO_SCROLL_EDGE_PX = 36;
const DEFAULT_AUTO_SCROLL_MAX_PER_FRAME = 14;

export interface ListReorderAutoScroll {
  containerRef: { readonly current: HTMLElement | null };
  edgePx?: number;
  maxPerFrame?: number;
  /** Inset of the far-edge band, e.g. a trailing strip overlaying the
   *  container's right edge (the tab bar passes its measured strip width). */
  endInsetPx?: number;
}

export interface ListReorderOptions {
  ids: string[];
  /**
   * Fires once on a committed drop. `orderedIds` is the full post-move order;
   * `sourceId`/`insertAt` (post-removal index) serve consumers whose store
   * takes a move operation instead of a full order (tab bar).
   */
  onReorder: (orderedIds: string[], sourceId: string, insertAt: number) => void;
  /**
   * Optional pointerup-without-drag activation, for surfaces whose nested
   * button click is unreliable under WKWebView (the rail tile is asChild'd by
   * TooltipTrigger + ContextMenuTrigger, a known click-swallowing combo).
   */
  onPressActivate?: (id: string) => void;
  /** Reorder axis. Default "y" (vertical list). */
  axis?: "x" | "y";
  thresholdPx?: number;
  /** Body class applied while dragging (global grabbing cursor). The CSS in
   *  index.css covers both `is-reordering-projects` and `is-reordering-tabs`. */
  bodyClass?: string;
  /** When true for an id, the hook ignores the press entirely (no drag, no
   *  press-activate). Covers "editing this item" / "nothing to reorder". */
  dragDisabled?: (id: string) => boolean;
  /** Enable edge auto-scroll of a scrolling container during the drag. */
  autoScroll?: ListReorderAutoScroll;
}

export interface ListReorderHandle {
  /** Item currently being dragged (drives dim-in-place + the surface ghost). */
  draggingId: string | null;
  /** Raw insertion slot 0..ids.length while dragging, else null. Includes the
   *  two source-adjacent no-op slots; consumers filter for their indicator. */
  dropIndex: number | null;
  /** Viewport pointer position while dragging; anchors the surface's ghost. */
  pointerPos: { x: number; y: number } | null;
  /** Center Y (px, container space) for the drop indicator. Only computed on
   *  the y axis (null on x); already hides the source-adjacent no-op slots. */
  indicatorTop: number | null;
  itemRef: (id: string) => (el: HTMLElement | null) => void;
  getItemEl: (id: string) => HTMLElement | null;
  getItemProps: (id: string) => {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => void;
    onClickCapture: (e: RMouseEvent<HTMLElement>) => void;
  };
}

export function useListReorder(options: ListReorderOptions): ListReorderHandle {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);

  // One DOM ref per item wrapper: drop-slot math + indicator geometry.
  const itemEls = useRef<Map<string, HTMLElement>>(new Map());
  const itemRef = (id: string) => (el: HTMLElement | null) => {
    if (el) itemEls.current.set(id, el);
    else itemEls.current.delete(id);
  };
  const getItemEl = (id: string) => itemEls.current.get(id) ?? null;

  const suppressClicksUntil = useRef(0);

  // Handlers are registered at pointerdown time; every mid-gesture read (ids,
  // callbacks, axis, auto-scroll insets) goes through this ref so a re-render
  // mid-drag can't act on a stale closure.
  const optsRef = useRef(options);
  optsRef.current = options;

  const axis = options.axis ?? "y";
  const bodyClass = options.bodyClass ?? "is-reordering-projects";

  // Global cursor while dragging: a body class so EVERY element (including
  // buttons that opt into cursor:pointer) shows the grabbing cursor.
  useEffect(() => {
    if (!draggingId) return;
    document.body.classList.add(bodyClass);
    return () => {
      document.body.classList.remove(bodyClass);
    };
  }, [draggingId, bodyClass]);

  // Walk visible items start-to-end; the first one whose midpoint sits past
  // the pointer is the insertion slot. Falling past all of them means "append".
  const computeDropIndex = (clientCoord: number): number => {
    const { ids } = optsRef.current;
    const isX = (optsRef.current.axis ?? "y") === "x";
    for (let i = 0; i < ids.length; i++) {
      const el = itemEls.current.get(ids[i]);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const mid = isX ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      if (clientCoord < mid) return i;
    }
    return ids.length;
  };

  const onPointerDown = (id: string) => (e: RPointerEvent<HTMLElement>) => {
    // Only left-button presses initiate drag. Right-click falls through to the
    // context menu trigger; middle/etc. are ignored.
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // Skip presses on open menus and on descendants that opted out of drag.
    if (target?.closest("[role=menu],[data-no-drag]")) return;
    if (optsRef.current.dragDisabled?.(id)) return;

    const isX = (optsRef.current.axis ?? "y") === "x";
    const threshold = optsRef.current.thresholdPx ?? DEFAULT_THRESHOLD_PX;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let localDropIndex: number | null = null;
    let lastCoord = isX ? startX : startY;
    let autoScrollRaf = 0;

    // Edge auto-scroll of the consumer's scrolling container; recomputes the
    // drop slot after each scroll tick since the items shifted under the
    // (stationary) pointer.
    const tickAutoScroll = () => {
      const conf = optsRef.current.autoScroll;
      const el = conf?.containerRef.current;
      if (!conf || !el) {
        autoScrollRaf = 0;
        return;
      }
      const edge = conf.edgePx ?? DEFAULT_AUTO_SCROLL_EDGE_PX;
      const maxPerFrame = conf.maxPerFrame ?? DEFAULT_AUTO_SCROLL_MAX_PER_FRAME;
      const endInset = conf.endInsetPx ?? 0;
      const rect = el.getBoundingClientRect();
      const fromStart = isX ? lastCoord - rect.left : lastCoord - rect.top;
      const fromEnd = isX
        ? rect.right - endInset - lastCoord
        : rect.bottom - endInset - lastCoord;
      let delta = 0;
      if (fromStart < edge) {
        const ratio = 1 - Math.max(0, fromStart) / edge;
        delta = -ratio * maxPerFrame;
      } else if (fromEnd < edge) {
        const ratio = 1 - Math.max(0, fromEnd) / edge;
        delta = ratio * maxPerFrame;
      }
      if (delta !== 0) {
        if (isX) el.scrollLeft += delta;
        else el.scrollTop += delta;
        const idx = computeDropIndex(lastCoord);
        localDropIndex = idx;
        setDropIndex(idx);
      }
      autoScrollRaf = requestAnimationFrame(tickAutoScroll);
    };

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < threshold) return;
        dragging = true;
        setDraggingId(id);
        if (optsRef.current.autoScroll) {
          autoScrollRaf = requestAnimationFrame(tickAutoScroll);
        }
      }
      lastCoord = isX ? ev.clientX : ev.clientY;
      const idx = computeDropIndex(lastCoord);
      localDropIndex = idx;
      setDropIndex(idx);
      setPointerPos({ x: ev.clientX, y: ev.clientY });
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
      setDraggingId(null);
      setDropIndex(null);
      setPointerPos(null);
    };

    const onUp = () => {
      if (dragging && localDropIndex != null) {
        const order = optsRef.current.ids;
        const sourceIdx = order.indexOf(id);
        // Drops at the source's own slots (`i` and `i+1`) are no-ops; skip.
        if (sourceIdx >= 0 && localDropIndex !== sourceIdx && localDropIndex !== sourceIdx + 1) {
          const next = [...order];
          next.splice(sourceIdx, 1);
          const insertAt = localDropIndex > sourceIdx ? localDropIndex - 1 : localDropIndex;
          next.splice(insertAt, 0, id);
          optsRef.current.onReorder(next, id, insertAt);
        }
        suppressClicksUntil.current = performance.now() + CLICK_SUPPRESS_MS;
      } else if (!dragging && optsRef.current.onPressActivate) {
        // Activate from pointerup so the item switches even when the child
        // button's click never arrives; the suppression window below swallows
        // the click when it DOES arrive, preventing a double activation.
        suppressClicksUntil.current = performance.now() + CLICK_SUPPRESS_MS;
        optsRef.current.onPressActivate(id);
      }
      cleanup();
    };

    const onCancel = () => cleanup();

    // Escape aborts an in-flight drag. The press is still held, so arm the
    // suppression window at the eventual release: releasing after a cancel
    // must not read as a click/select.
    const onKey = (ke: KeyboardEvent) => {
      if (ke.key !== "Escape" || !dragging) return;
      ke.preventDefault();
      ke.stopPropagation();
      cleanup();
      window.addEventListener(
        "pointerup",
        () => {
          suppressClicksUntil.current = performance.now() + CLICK_SUPPRESS_MS;
        },
        { once: true },
      );
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
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

  // Indicator geometry for vertical lists, in the container's offset space.
  // Hidden on the two slots adjacent to the source item (dropping there is a
  // no-op and the line would be misleading).
  const ids = options.ids;
  const sourceIdx = draggingId ? ids.indexOf(draggingId) : -1;
  let indicatorTop: number | null = null;
  if (
    axis === "y" &&
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

  return { draggingId, dropIndex, pointerPos, indicatorTop, itemRef, getItemEl, getItemProps };
}

/**
 * Insertion indicator for a vertical reorder drag: a 2px rule bookended by two
 * dot caps so the line reads as deliberate against any item color. Positioned
 * in the container's flow (the container must be `relative`), centered on
 * `top`, so surrounding items never reflow as the pointer moves between gaps.
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
