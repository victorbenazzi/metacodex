# 006: Unify motion tokens and progress

- **Status**: DONE
- **Commit**: 3cda0a8
- **Severity**: MEDIUM
- **Category**: Cohesion, easing, and performance
- **Estimated scope**: 3 files, medium edits

## Problem

`src/styles/tokens.css:174-179` defines custom motion values, but `tailwind.config.js:105-107` only overrides the default timing function. Tailwind therefore resolves the explicit class `ease-out` to its weak built-in curve.

Progress has two additional problems:

```js
// tailwind.config.js:200, current
"progress-indeterminate": "progress-indeterminate 1.4s ease-in-out infinite"
```

```tsx
// src/components/project-rail/CloneFromGithubDialog.tsx:353-354, current
className="... transition-[width] duration-base ease-out"
style={{ width: `${percent}%` }}
```

## Target

Use the exact shared curves:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

Tailwind mappings:

```js
transitionTimingFunction: {
  DEFAULT: "var(--ease-out)",
  out: "var(--ease-out)",
  "in-out": "var(--ease-in-out)",
  drawer: "var(--ease-drawer)",
}
```

Determinate progress uses a full-width bar with `transform: scaleX(percent / 100)` and `transform-origin: left`. Indeterminate progress uses `linear`.

## Repo conventions to follow

- Motion tokens live in `src/styles/tokens.css`.
- Tailwind is the class-level bridge to those tokens.
- Keep popup fade durations and the documented popup exit decision unchanged.

## Steps

1. Update and add the three timing tokens exactly as shown.
2. Map explicit Tailwind easing utilities to the tokens.
3. Change `progress-indeterminate` to `1.4s linear infinite`.
4. Make the determinate progress span `w-full origin-left transition-transform duration-base ease-out`.
5. Replace dynamic width with a clamped `scaleX` transform string.
6. Add reduced-motion behavior that removes indeterminate translation but preserves an opacity pulse.

## Boundaries

- Do not change clone state or percentage calculation.
- Do not add a progress component dependency.

## Verification

- **Mechanical**: resolve Tailwind config and confirm `out` equals `var(--ease-out)`. Run typecheck and build.
- **Feel check**: indeterminate progress must move at constant speed; percentage updates must glide without relayout.
- **Done when**: progress animates only transform and explicit `ease-out` uses the project token.
