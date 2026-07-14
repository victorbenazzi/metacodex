# 004: Remove operational row entrances

- **Status**: TODO
- **Commit**: 3cda0a8
- **Severity**: HIGH
- **Category**: Purpose and frequency
- **Estimated scope**: 2 files, small deletion

## Problem

`src/components/code-sidebar/CodeProjectGroup.tsx:50-52` creates a stagger, and every row at `:403-408` mounts with a 240ms keyframe:

```tsx
style={{ animationDelay: delay }}
className="... animate-rise ... motion-reduce:animate-none"
```

The animation comes from `tailwind.config.js:202`:

```js
rise: "rise 240ms var(--ease-out) both"
```

In vertical layout, a terminal opened by `mod+t` can wait behind the stagger before becoming visually settled.

## Target

- Histórico, Agentes, Terminais, and Arquivos rows mount immediately.
- No row prop carries an animation delay.
- Remove the unused rise keyframe and animation registration if no other use exists.

## Repo conventions to follow

- Keep row hover colors and focus-visible rings.
- Keep current section ordering and counts.

## Steps

1. Remove `STAGGER_CAP`, `STAGGER_STEP_MS`, `staggerIndex`, and `nextDelay`.
2. Remove the `delay` prop from `RowShell`, `HistoricoRow`, `TabRow`, and `FileRow`.
3. Remove `style.animationDelay`, `animate-rise`, and its reduced-motion override.
4. Delete the `rise` keyframe and animation entry from Tailwind if `rg 'animate-rise' src` returns no other use.

## Boundaries

- Do not change row markup beyond delay plumbing.
- Do not animate row removal.

## Verification

- **Mechanical**: `rg 'animate-rise|STAGGER_' src tailwind.config.js` must return no result. Run typecheck and build.
- **Feel check**: add several terminals and files in vertical layout. Rows must appear immediately without a delayed cascade.
- **Done when**: operational rows contain no entrance keyframes.
