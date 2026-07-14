# 011: Refine the workspace drawers

- **Status**: DONE
- **Commit**: a4653f2
- **Severity**: HIGH
- **Category**: Physicality, cohesion, and easing
- **Estimated scope**: 3 files, medium edit

## Problem

The projects, explorer, and right-side Git or agents drawers currently snap
their grid geometry while their contents run a separate short translation.
The two phases do not describe the same physical movement, so opening and
closing feel clipped and coarse.

```tsx
// src/app/AppShell.tsx:159-168, current
const projectsColWidth = codeSidebarCollapsed ? RAIL_WIDTH_PX : projectsWidth;
const explorerColWidth = explorerCollapsed ? 0 : explorerWidth;
const sidePanelColWidth = panelOpen ? sourceControlWidth : 0;

return (
  <div
    className="relative grid h-screen w-screen grid-rows-[var(--title-bar-h)_minmax(0,1fr)] bg-canvas text-ink"
    style={{ gridTemplateColumns }}
  >
```

The content then tries to compensate with an unrelated offset:

```tsx
// src/app/AppShell.tsx:242-245, current
"absolute inset-y-0 left-0 h-full transition-[opacity,transform] duration-base ease-out",
explorerCollapsed
  ? "pointer-events-none -translate-x-[14px] opacity-0"
  : "translate-x-0 opacity-100"
```

Equivalent offsets exist for the projects sidebar and the right side panel.

## Target

- Interpolate `grid-template-columns` for drawer toggles only.
- Use a dedicated `--dur-drawer: 240ms` token and the existing
  `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` curve.
- Disable the grid transition while any resize handle is being dragged.
- Projects, explorer, and right-side gaps move in the same grid transition as
  their columns.
- Remove the independent content translations. Content uses opacity only with
  the same `--dur-drawer: 240ms` and
  `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` timing as the grid.
- Keep the compact projects rail fixed at `--rail-w: 48px` while the outer
  projects track interpolates. Its card and icons must never stretch across the
  expanded panel width during the crossfade.
- Keep full-width drawer contents inside `overflow-hidden` clips so the reveal
  edge stays clean throughout the column interpolation.
- Keep the right panel mounted through its 240ms close transition.
- Under `prefers-reduced-motion`, grid movement is removed and content keeps
  opacity feedback only.

## Repo conventions to follow

- Motion tokens live in `src/styles/tokens.css`.
- Tailwind duration and easing bridges live in `tailwind.config.js`.
- `ResizeHandle` already exposes `onDraggingChange`; connect all three handles
  to one `resizing` state in `src/app/AppShell.tsx`.
- Preserve the existing fixed-width inner drawer pattern and the documented
  WKWebView behavior elsewhere.

## Steps

1. Add `--dur-drawer: 240ms` beside the existing motion durations in
   `src/styles/tokens.css`.
2. Add `drawer: "var(--dur-drawer)"` to `transitionDuration` in
   `tailwind.config.js`. Keep the existing `ease-drawer` mapping.
3. Change `DRAWER_ANIMATION_MS` in `src/app/AppShell.tsx` to `240` so delayed
   unmounting matches the CSS token.
4. Restore one `resizing` state in `AppShell`. Apply
   `transition-[grid-template-columns] duration-drawer ease-drawer` to the root
   grid only while `resizing` is false. Add
   `motion-reduce:transition-none`.
5. Pass `onDraggingChange={setResizing}` to the projects, explorer, and right
   panel resize handles.
6. Replace the projects rail and expanded sidebar
   `transition-[opacity,transform]` classes with opacity-only transitions using
   `duration-drawer ease-drawer`. Remove every open and closed `translate-x`
   class from those surfaces.
7. Fix the compact rail wrapper to `w-[var(--rail-w)]` anchored on the left so
   its content stays at 48px throughout both directions of the grid transition.
8. Apply the same opacity-only 240ms treatment to the explorer and right panel
   contents. Restore an always-clipped right-panel container because its grid
   track now remains visible throughout the close transition.
9. Preserve pointer-event and `aria-hidden` behavior for every closed surface.

## Boundaries

- Do not animate grid geometry during pointer resize.
- Do not animate `width`, `height`, `top`, or `left` inside drawer contents.
- Do not change stored panel widths, gaps, resize limits, or persistence.
- Do not change terminal mounting, xterm setup, or side-panel view semantics.
- Do not add dependencies.
- Do not add em-dash or en-dash characters.

## Verification

- **Mechanical**: run `pnpm exec tsc --noEmit`, `pnpm build`, and
  `git diff --check`. Confirm no drawer content retains a translate transition.
- **Feel check**: open and close projects, explorer, and the right-side panel
  repeatedly. Column, gap, clipping edge, and workspace must move as one
  continuous drawer. No content should chase the layout or disappear early.
- **Resize check**: drag all three resize handles. Width must track the pointer
  without easing or lag.
- **Stress check**: toggle each drawer rapidly. CSS transitions must retarget
  from the current interpolated state without restarting.
- **Reduced motion**: drawer geometry snaps while opacity feedback remains.
- **Done when**: all four visible drawer surfaces open and close with one crisp,
  interruptible 240ms motion and no secondary slide.
