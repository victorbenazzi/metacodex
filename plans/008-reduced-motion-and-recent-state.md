# 008: Preserve information under reduced motion

- **Status**: DONE
- **Commit**: 3cda0a8
- **Severity**: MEDIUM
- **Category**: Accessibility and performance
- **Estimated scope**: 9 files, medium edits

## Problem

`src/index.css:122-133` collapses every animation and transition to 0.01ms. This also deletes opacity and color feedback. JavaScript smooth scrolling in `MarkdownPreview.tsx:192` ignores that CSS rule.

Recent explorer entries animate `backgroundColor` on the button for 15 seconds through `tailwind.config.js:152-159` and `TreeNode.tsx:128`, which causes paint and loses the informational tint immediately under the global reduced-motion rule.

Several loading icons use `animate-spin` without a reduced-motion override.

## Target

- Remove the universal 0.01ms override.
- Movement components own targeted reduced-motion behavior.
- Position changes are removed, but opacity and color feedback remain at 200ms or the existing token duration.
- JavaScript uses `behavior: "auto"` when reduced motion is requested.
- Recent-file tint uses opacity on a pseudo-element or isolated overlay, not animated background color.
- Under reduced motion, recent tint stays static for the 15-second store TTL.
- Spinner icons become static under reduced motion.

## Repo conventions to follow

- Keep `RECENT_TTL_MS = 15_000` as the source of truth for recent state.
- Keep the existing `--explorer-recent` color.
- Use `motion-reduce:*` utilities where they are readable, and CSS media queries for pseudo-elements.

## Steps

1. Delete the universal duration override from `index.css`.
2. Add a reusable `prefers-reduced-motion` query for the recent-state pseudo-element and Explorer pill motion.
3. Replace `animate-explorer-recent-tint` with a class whose pseudo-element animates only opacity. Use the existing 15s total with the fade beginning at 96 percent.
4. Preserve a static pseudo-element tint during reduced motion until the store removes the class.
5. In `MarkdownPreview`, branch smooth scrolling with `matchMedia("(prefers-reduced-motion: reduce)")`.
6. Add `motion-reduce:animate-none` to all spinner icons.
7. Give indeterminate progress and moving panel surfaces component-specific reduced-motion behavior.

## Boundaries

- Do not remove useful loading or status feedback.
- Do not change the recent-state TTL.
- Do not add a global rule that disables every transition.

## Verification

- **Mechanical**: `rg '0.01ms' src` must return no result. Run typecheck and build.
- **Feel check**: enable reduced motion in DevTools. Panels must not travel, Markdown anchors must jump, opacity feedback must remain, and new files must stay visibly marked for 15 seconds.
- **Done when**: reduced motion removes movement without deleting information.
