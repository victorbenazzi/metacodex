# 005: Share tooltip timing

- **Status**: TODO
- **Commit**: 3cda0a8
- **Severity**: MEDIUM
- **Category**: Easing and duration
- **Estimated scope**: 2 files, small refactor

## Problem

Every tooltip creates a separate provider in `src/components/ui/Tooltip.tsx:22`:

```tsx
<RT.Provider delayDuration={delayDuration} skipDelayDuration={100}>
```

The instant state still animates at `:34`:

```tsx
"data-[state=delayed-open]:animate-fade-in data-[state=instant-open]:animate-fade-in data-[state=closed]:animate-fade-out"
```

Moving across toolbar controls therefore repeats a 200ms delay and 150ms fade.

## Target

- One provider wraps the app with `delayDuration={200}` and `skipDelayDuration={100}`.
- Individual roots may override `delayDuration` if their public prop requires it.
- Only `data-[state=delayed-open]` fades in.
- `data-[state=instant-open]` appears instantly.
- Closed tooltips keep the documented 105ms fade-out.

## Repo conventions to follow

- Keep the shared `Tooltip` component as the only Radix tooltip wrapper.
- Keep collision padding at 8px and current typography.

## Steps

1. Export a small `TooltipProvider` wrapper from `Tooltip.tsx` or export the Radix provider through the module.
2. Wrap the app content once in `src/App.tsx`.
3. Remove the per-tooltip provider.
4. Pass the local delay to `RT.Root` only when required.
5. Remove `animate-fade-in` from `instant-open`.

## Boundaries

- Do not change tooltip content or placement.
- Do not change the first-tooltip 200ms delay.

## Verification

- **Mechanical**: typecheck and build.
- **Feel check**: hover the title-bar controls in sequence. The first tooltip waits 200ms; adjacent tooltips appear immediately and without a fade.
- **Done when**: exactly one provider controls tooltip skip timing.
