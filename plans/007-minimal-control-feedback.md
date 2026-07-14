# 007: Make control feedback minimal and bounded

- **Status**: DONE
- **Commit**: 3cda0a8
- **Severity**: MEDIUM
- **Category**: Physicality, timing, and performance
- **Estimated scope**: 7 files, focused class edits

## Problem

Primary press feedback is too fast and uses `ease-in` in `src/styles/tokens.css:410-417`:

```css
.press-feedback {
  transition: transform var(--press-dur) var(--ease-in);
}
```

The token is 80ms. `ExplorerTogglePill.tsx:68-71` stretches to 1.10 and compresses to 0.90. Spatial hover motion is also ungated in `ProjectTile.tsx:89-91`, `ProjectContextMenu.tsx:225`, and `AboutPane.tsx:162`.

Two controls use unbounded transitions:

```tsx
// ThemeCard.tsx:32
"... transition-all"

// TabBar.tsx:419
"... transition-all duration-fast ..."
```

## Target

Press feedback:

```css
--press-scale: 0.97;
--press-dur: 160ms;
--press-release-dur: 100ms;

.press-feedback {
  transition: transform var(--press-release-dur) var(--ease-out);
}
.press-feedback:active {
  transform: scale(var(--press-scale));
  transition-duration: var(--press-dur);
}
```

- Remove decorative spatial motion from high-frequency project tiles, color swatches, and the About link.
- Explorer pill may use `scaleY(1.04)` on fine-pointer hover and `scaleY(0.97)` while active.
- Reduced motion removes Explorer pill transforms.
- Theme card transitions only border color and box shadow.
- Tab close transitions only opacity, background color, and color.

## Repo conventions to follow

- Keep token classes and shared Button primitives.
- Keep the project rail crisp and professional, with no bounce.
- Keep focus-visible treatments unchanged.

## Steps

1. Update press tokens and asymmetric CSS exactly as shown.
2. Remove lift and active scaling from `ProjectTile`; keep bounded color or shadow feedback.
3. Remove scale hover from project color swatches.
4. Remove diagonal icon movement from the About link.
5. Replace Explorer pill Tailwind transform states with named CSS classes gated by `@media (hover: hover) and (pointer: fine)`.
6. Replace both `transition-all` uses with explicit property lists.

## Boundaries

- Do not add bounce or springs to ordinary controls.
- Do not change colors, radii, sizes, or layout.

## Verification

- **Mechanical**: `rg 'transition-all|hover:scale-105|hover:-translate-y|group-hover:-translate' src` must return no relevant control-motion violations. Run typecheck and build.
- **Feel check**: primary buttons compress subtly, project navigation stays quiet, and Explorer pill remains discoverable without feeling elastic.
- **Done when**: all control transitions are bounded and pointer motion is gated.
