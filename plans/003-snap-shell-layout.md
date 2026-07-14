# 003: Stop animating workspace layout

- **Status**: TODO
- **Commit**: 3cda0a8
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 2 files, small edits

## Problem

The root workspace grid animates `grid-template-columns` in `src/app/AppShell.tsx:176-181`:

```tsx
!resizing &&
  "transition-[grid-template-columns] duration-base ease-out motion-reduce:transition-none"
```

This recalculates layout for the editor, xterm canvas, and every visible panel on each frame. `src/components/side-panel/SidePanel.tsx:107-113` separately animates measured `height`:

```tsx
"transition-[height] duration-base ease-out motion-reduce:transition-none"
```

## Target

- Grid columns and side-panel height snap to their new values.
- Existing panel content may retain 180ms transform and opacity transitions for pointer-triggered drawer feedback.
- Under reduced motion, panel movement becomes opacity-only for 180ms.

## Repo conventions to follow

- Preserve the floating-panel grid structure and persisted widths.
- Preserve `useDelayedFlag` while exit content still uses the existing 180ms inner transition.
- Preserve the rule that transitions are disabled during resize dragging.

## Steps

1. Remove the grid-template transition class and the now-unused `resizing` state only if no longer needed by any other behavior.
2. Keep resize handles functional and persisted widths unchanged.
3. Remove `transition-[height]` from `SidePanel`; keep its measured height logic so the two views still size correctly.
4. Add `motion-reduce:transform-none motion-reduce:transition-opacity` to moving panel interiors while retaining `duration-base`.

## Boundaries

- Do not redesign the AppShell grid.
- Do not change panel widths, gaps, or persistence.
- Do not change xterm mounting behavior.

## Verification

- **Mechanical**: run `pnpm exec tsc --noEmit` and `pnpm build`.
- **Feel check**: open and close projects, explorer, and source-control panels while a terminal prints continuously. Terminal output must remain smooth.
- **Done when**: no transition targets `grid-template-columns` or `height`.
