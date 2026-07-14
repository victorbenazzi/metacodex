# 002: Move drag tracking to the compositor

- **Status**: DONE
- **Commit**: 3cda0a8
- **Severity**: HIGH
- **Category**: Performance and physicality
- **Estimated scope**: 4 files, medium interaction refactor

## Problem

`src/components/ui/useListReorder.tsx:208-221` stores pointer coordinates in React state on every `pointermove`:

```tsx
const idx = computeDropIndex(lastCoord);
localDropIndex = idx;
setDropIndex(idx);
setPointerPos({ x: ev.clientX, y: ev.clientY });
```

The three consumers position fixed ghosts with layout properties:

```tsx
// src/components/tabs/TabBar.tsx:489-492, current
style={{
  left: drag.pointerPos.x + 10,
  top: drag.pointerPos.y - 10,
}}
```

Equivalent `top` and `left` writes exist in `ExpandedProjectsSidebar.tsx:123-126` and `MiniProjectSidebar.tsx:109-112`. Reordered items then teleport to their final positions after drop.

## Target

- Pointer movement never writes coordinates to React state after the drag begins.
- Ghost movement uses direct element writes to a full `transform: translate3d(...)` string.
- DOM writes are coalesced to one `requestAnimationFrame`.
- `dropIndex` state updates only when the insertion slot changes.
- Reordered items use FLIP with WAAPI after drop:

```ts
element.animate(
  [
    { transform: `translate3d(${dx}px, ${dy}px, 0)` },
    { transform: "translate3d(0, 0, 0)" },
  ],
  { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
);
```

- Skip FLIP when `matchMedia("(prefers-reduced-motion: reduce)").matches` is true.

## Repo conventions to follow

- Keep the shared `useListReorder` hook as the single owner of reorder behavior.
- Preserve the documented WKWebView decision not to use `setPointerCapture`.
- Keep `data-no-drag`, trailing-click suppression, Escape cancellation, and edge auto-scroll intact.

## Steps

1. Extend `ListReorderOptions` with a pointer callback suitable for direct ghost positioning.
2. Keep one initial coordinate in state only to mount the ghost. Send later coordinates through the callback and an animation-frame scheduler.
3. Compare the next insertion index with `localDropIndex` before calling `setDropIndex` in pointer and auto-scroll paths.
4. Change all three ghosts to `left: 0`, `top: 0`, `will-change: transform`, and direct transform writes through refs.
5. Capture item rectangles immediately before a committed reorder.
6. In a layout effect after `ids` change, animate non-zero position deltas with WAAPI for 180ms using `cubic-bezier(0.23, 1, 0.32, 1)`.
7. Cancel prior WAAPI animations on the same element before starting a new one.

## Boundaries

- Do not add a drag library.
- Do not add pointer capture.
- Do not animate width, height, top, or left.
- Do not change reorder persistence or ordering semantics.

## Verification

- **Mechanical**: run `pnpm exec tsc --noEmit` and `pnpm build`.
- **Feel check**: drag projects in both sidebars and tabs under active terminal output. The ghost must stay attached to the pointer, and dropped siblings must glide into position without bounce.
- **Slow motion**: inspect at 10 percent playback and confirm only transforms change.
- **Done when**: pointer coordinates do not update React state per frame and no drag ghost uses changing top or left.
