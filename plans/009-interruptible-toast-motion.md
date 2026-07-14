# 009: Add interruptible toast motion

- **Status**: TODO
- **Commit**: 3cda0a8
- **Severity**: MEDIUM
- **Category**: Missed opportunity and interruptibility
- **Estimated scope**: 2 files, medium lifecycle work

## Problem

`src/components/ui/Toaster.tsx:22-64` mounts and removes toast rows immediately. Auto-dismiss calls store removal directly after the timeout. New rows teleport in, dismissed rows disappear, and remaining rows jump to new positions.

## Target

Use transitions, not keyframes:

```css
.toast-row {
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out);
}
.toast-row[data-state="entering"] {
  opacity: 0;
  transform: translateY(8px);
}
.toast-row[data-state="exiting"] {
  opacity: 0;
  transform: translateY(4px);
  transition-duration: var(--dur-exit);
}
```

- Mount in `entering`, switch to `visible` on the next animation frame.
- Manual and automatic dismissal switch to `exiting`, then remove from the store after 105ms.
- Stack reflow uses FLIP with WAAPI for 180ms and `cubic-bezier(0.77, 0, 0.175, 1)`.
- Reduced motion keeps the opacity transition and removes translate values.

## Repo conventions to follow

- Keep the Zustand toast store as the source of toast data.
- Keep error toasts sticky.
- Keep the current visual chrome and 8px stack gap.

## Steps

1. Add local visual state to `ToastRow` and a single `beginDismiss` path for timeout and close button.
2. Delay store removal until exit opacity completes.
3. Add stable element refs in `Toaster` and record previous rectangles.
4. Animate stack deltas with transform-only WAAPI after layout.
5. Add the toast CSS next to the shared motion utilities in `tokens.css` or `index.css`.
6. Cancel timers, frames, and animations on unmount.

## Boundaries

- Do not add Sonner or another toast dependency.
- Do not add bounce.
- Do not animate height.

## Verification

- **Mechanical**: typecheck and build.
- **Feel check**: trigger several success and error toasts, dismiss the middle one, and let another auto-dismiss. Entry, exit, and stack movement must remain smooth when interrupted.
- **Slow motion**: confirm rows never overlap with a visible jump and only opacity or transform changes.
- **Done when**: toasts have interruptible entry and exit plus spatially continuous stacking.
