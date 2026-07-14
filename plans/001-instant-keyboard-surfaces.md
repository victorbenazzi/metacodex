# 001: Make keyboard surfaces instant

- **Status**: TODO
- **Commit**: 3cda0a8
- **Severity**: HIGH
- **Category**: Purpose and frequency
- **Estimated scope**: 7 files, small focused edits

## Problem

Keyboard actions used repeatedly every day animate before they become usable.

`src/components/command-palette/CommandPalette.tsx:194` and `:203` currently contain:

```tsx
"data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
```

`src/components/search/SearchDialog.tsx:106` and `:114` use the same classes. The surfaces are opened by `mod+p`, `mod+shift+p`, and `mod+shift+f` in `src/features/keybindings/commands.ts:73-88`.

Tab and project navigation also interpolate state on keyboard actions:

```tsx
// src/components/tabs/TabBar.tsx:365, current
"touch-none border transition-colors duration-fast"

// src/components/ui/SidebarRow.tsx:38, current
"... transition-colors duration-fast"
```

Offscreen tabs additionally use `behavior: "smooth"` at `src/components/tabs/TabBar.tsx:241-246`.

## Target

- Command palette and search open and close without animation.
- Active tab and active project identity update without color interpolation.
- Programmatic tab reveal uses `behavior: "auto"`.
- Hover feedback may remain only when it does not also animate keyboard state.

## Repo conventions to follow

- Keep all current Radix markup, focus management, and accessibility attributes.
- Keep the documented fade behavior on occasional dialogs. This plan changes only high-frequency keyboard surfaces.
- Use `cn()` for conditional classes, as the current components already do.

## Steps

1. In `CommandPalette.tsx`, remove the open and closed animation classes from both overlay and content.
2. In `SearchDialog.tsx`, remove the open and closed animation classes from both overlay and content.
3. In `TabBar.tsx`, remove the active-state color transition from the tab root and change both smooth scroll calls to `behavior: "auto"`.
4. In `SidebarRow.tsx`, remove the color transition that runs when `active` changes.
5. In `ProjectTile.tsx`, ensure active project color and border changes are instant. Keep only explicitly justified pointer feedback.
6. Do not change Settings or ordinary dialogs, which are occasional surfaces.

## Boundaries

- Do not change keyboard bindings or command dispatch.
- Do not change Radix dialog structure.
- Do not add input-modality tracking.
- Do not add dependencies.

## Verification

- **Mechanical**: run `pnpm exec tsc --noEmit` and `pnpm build`.
- **Feel check**: repeatedly press `mod+p`, `mod+shift+p`, `mod+shift+f`, `ctrl+tab`, and `mod+1` to `mod+9`. Every result must appear immediately.
- **Done when**: no animation class remains on command palette or search, and keyboard tab or project changes have no interpolated state.
