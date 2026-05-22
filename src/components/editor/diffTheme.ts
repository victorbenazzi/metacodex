import { EditorView } from "@codemirror/view";

/**
 * Overrides for `@codemirror/merge`'s baseTheme so the side-by-side diff speaks
 * metacodex tokens (warm add/remove tints) instead of the library's saturated
 * green/red. The base rules carry a `&light`/`&dark` prefix and our editor theme
 * is built with `{ dark: false }`, so the base always resolves to its light
 * branch — `!important` keeps these overrides winning regardless. The token
 * values themselves flip with `data-theme`, so dark mode stays correct.
 */
export function buildMergeTheme() {
  return EditorView.theme({
    // Changed lines: a faint wash. Removed side (a / HEAD) leans warm-red,
    // added side (b / working) leans warm-green.
    "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
      backgroundColor: "var(--diff-remove-line) !important",
    },
    "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
      backgroundColor: "var(--diff-add-line) !important",
    },
    // The actual edited spans — a flat tint, never the library's gradient.
    "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText": {
      background: "var(--diff-remove-text) !important",
    },
    "&.cm-merge-b .cm-changedText": {
      background: "var(--diff-add-text) !important",
    },
    ".cm-deletedText": { background: "var(--diff-remove-text) !important" },
    // Thin gutter markers next to changed lines.
    "&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter": {
      background: "var(--diff-remove) !important",
    },
    "&.cm-merge-b .cm-changedLineGutter": {
      background: "var(--diff-add) !important",
    },
    // Collapsed unchanged stretches — a quiet hairline band, not a grey gradient.
    ".cm-collapsedLines": {
      color: "var(--muted)",
      background: "var(--canvas-soft)",
      borderTop: "1px solid var(--hairline)",
      borderBottom: "1px solid var(--hairline)",
      fontFamily: "var(--font-sans)",
      fontSize: "11px",
      padding: "4px 10px",
    },
    // Read-only diff: never surface accept/reject affordances.
    ".cm-chunkButtons": { display: "none" },
  });
}
