# 010: Run the final motion review

- **Status**: DONE
- **Commit**: 3cda0a8
- **Severity**: HIGH
- **Category**: Verification
- **Estimated scope**: whole motion diff, review only

## Problem

The implementation crosses shared tokens, high-frequency surfaces, gestures, overlays, and accessibility. Mechanical success alone cannot prove that it feels premium and minimal.

## Target

The final diff contains:

- no animation on keyboard-driven surfaces;
- no `transition-all`;
- no animated `width`, `height`, `top`, `left`, or `grid-template-columns`;
- no `ease-in` except the documented popup exit decision;
- no spatial hover without `@media (hover: hover) and (pointer: fine)`;
- reduced motion that removes movement but keeps opacity and state feedback;
- toast and reorder motion that is interruptible and uses transform or opacity only.

## Repo conventions to follow

- Apply `/Users/victor/.agents/skills/review-animations/STANDARDS.md`.
- Respect the documented popup fade and WKWebView pointer-capture decisions.
- Keep the app crisp, professional, and minimal.

## Steps

1. Inspect `git diff 3cda0a8`.
2. Run targeted searches for every escalation trigger in the review skill.
3. Run `pnpm exec tsc --noEmit` and `pnpm build`.
4. Review the diff against repo standards and this plan set.
5. Fix every blocking motion regression and rerun validation.

## Boundaries

- Do not broaden into non-motion refactors.
- Do not change documented product decisions without evidence.
- Do not add dependencies.

## Verification

- **Mechanical**: all commands pass and searches show no unexplained escalation trigger.
- **Feel check**: inspect keyboard flows, panel toggles, drag reorder, tooltips, progress, primary buttons, toasts, and reduced motion.
- **Done when**: `review-animations` returns Approve.
