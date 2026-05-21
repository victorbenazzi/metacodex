import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Editor theme built on CSS variables. We pull computed values at construction
 * time so the theme picks up the current light/dark palette.
 */
function v(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

export function buildEditorTheme() {
  const ink = v("--ink", "#26251e");
  const body = v("--body", "#5a5852");
  const muted = v("--muted", "#807d72");
  const mutedSoft = v("--muted-soft", "#a09c92");
  const canvas = v("--canvas", "#f7f7f4");
  const hairline = v("--hairline", "#e6e5e0");
  const selection = v("--term-selection", "rgba(38,37,30,0.18)");

  const theme = EditorView.theme(
    {
      "&": {
        color: ink,
        backgroundColor: canvas,
        fontFamily: 'var(--font-mono)',
        fontSize: "13px",
        height: "100%",
      },
      ".cm-content": {
        caretColor: ink,
        padding: "10px 12px",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: ink,
        borderLeftWidth: "1.5px",
      },
      "&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground": {
        background: selection,
      },
      ".cm-gutters": {
        backgroundColor: canvas,
        color: mutedSoft,
        border: "none",
        borderRight: `1px solid ${hairline}`,
        paddingRight: "6px",
        fontVariantNumeric: "tabular-nums",
      },
      ".cm-activeLine": { backgroundColor: "transparent" },
      ".cm-activeLineGutter": { color: ink, backgroundColor: "transparent" },
      ".cm-line": { padding: "0 4px" },
      ".cm-tooltip": {
        backgroundColor: v("--surface-card", "#fff"),
        color: ink,
        border: `1px solid ${hairline}`,
        borderRadius: "6px",
        padding: "4px 6px",
      },
      ".cm-tooltip-autocomplete > ul > li": {
        padding: "4px 8px",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: v("--surface-strong", "#e6e5e0") + "80",
        color: ink,
      },
      ".cm-searchMatch": { backgroundColor: "rgba(184, 134, 30, 0.25)" },
      ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        color: muted,
      },
    },
    { dark: false },
  );

  const highlight = HighlightStyle.define([
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: mutedSoft, fontStyle: "italic" },
    { tag: [t.keyword, t.controlKeyword, t.modifier, t.operatorKeyword], color: ink, fontWeight: "600" },
    { tag: [t.string, t.special(t.string)], color: v("--warn", "#b9722a") },
    { tag: [t.number, t.bool, t.null], color: v("--success", "#1f8a65") },
    { tag: [t.regexp, t.escape], color: v("--warn", "#b9722a") },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: ink },
    { tag: [t.variableName, t.propertyName], color: body },
    { tag: [t.typeName, t.className, t.namespace], color: ink, fontWeight: "500" },
    { tag: [t.tagName, t.angleBracket], color: v("--danger", "#cf2d56") },
    { tag: [t.attributeName], color: muted },
    { tag: [t.heading], color: ink, fontWeight: "600" },
    { tag: [t.link, t.url], color: v("--warn", "#b9722a"), textDecoration: "underline" },
    { tag: [t.strong], fontWeight: "600" },
    { tag: [t.emphasis], fontStyle: "italic" },
    { tag: [t.punctuation, t.bracket, t.brace, t.paren], color: muted },
  ]);

  return [theme, syntaxHighlighting(highlight)];
}
