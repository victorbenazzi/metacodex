import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Editor theme built on CSS variables. We pull computed values at construction
 * time so the theme picks up whichever palette `applyTheme()` last installed.
 * Chrome reads the design-system tokens (--ink, --canvas, --hairline, …);
 * syntax reads the dedicated --syntax-* tokens so swapping themes can recolor
 * code without touching the rest of the UI.
 */
function v(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

export interface EditorTypography {
  fontSize: number;
  fontFamily: string;
}

export function buildEditorTheme({ fontSize, fontFamily }: EditorTypography) {
  const ink = v("--ink", "#26251e");
  const body = v("--body", "#5a5852");
  const muted = v("--muted", "#807d72");
  const mutedSoft = v("--muted-soft", "#a09c92");
  const canvas = v("--canvas", "#f7f7f4");
  const hairline = v("--hairline", "#e6e5e0");
  const selection = v("--selection", "rgba(38,37,30,0.22)");

  const theme = EditorView.theme(
    {
      "&": {
        color: ink,
        backgroundColor: canvas,
        fontFamily,
        fontSize: `${fontSize}px`,
        height: "100%",
        position: "relative", // anchor for the sticky-scroll overlay
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
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "rgba(184, 134, 30, 0.45)",
      },
      ".cm-trailingSpace": { backgroundColor: "rgba(207, 45, 86, 0.12)" },
      // Sticky scroll overlay (see stickyScroll.ts).
      ".cm-stickyScroll": {
        position: "absolute",
        top: "0",
        right: "0",
        zIndex: "5",
        backgroundColor: v("--surface-card", "#fff"),
        borderBottom: `1px solid ${hairline}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        overflow: "hidden",
      },
      ".cm-stickyScroll-row": {
        padding: "0 8px 0 16px",
        fontFamily,
        fontSize: `${fontSize}px`,
        lineHeight: "1.5",
        color: ink,
        whiteSpace: "pre",
        overflow: "hidden",
        textOverflow: "ellipsis",
        cursor: "pointer",
      },
      ".cm-stickyScroll-row:hover": {
        backgroundColor: v("--surface-strong", "#e6e5e0") + "55",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        color: muted,
      },
      // Git change gutter — thin coloured bars vs HEAD (see gitGutter.ts).
      ".cm-gitGutter": { width: "4px", paddingLeft: "1px" },
      ".cm-gitGutter .cm-gutterElement": {
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
      },
      ".mcx-diff-bar": { width: "3px", borderRadius: "1px" },
      ".mcx-diff-added": { backgroundColor: "var(--diff-add)" },
      ".mcx-diff-modified": { backgroundColor: "var(--diff-modify)" },
      ".mcx-diff-deleted": {
        backgroundColor: "var(--diff-remove)",
        height: "3px",
        alignSelf: "flex-start",
        borderRadius: "0 0 2px 2px",
      },
      // Find & replace panel — styled to match the app tokens instead of the
      // CodeMirror default chrome.
      ".cm-panels": {
        backgroundColor: v("--surface-card", "#fff"),
        color: ink,
      },
      ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${hairline}` },
      ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${hairline}` },
      ".cm-search": {
        padding: "7px 10px",
        fontFamily: "var(--font-sans)",
        fontSize: "12px",
      },
      ".cm-search .cm-textfield": {
        backgroundColor: canvas,
        color: ink,
        border: `1px solid ${hairline}`,
        borderRadius: "4px",
        padding: "2px 6px",
        fontSize: "12px",
      },
      ".cm-search .cm-button": {
        backgroundColor: "transparent",
        backgroundImage: "none",
        color: body,
        border: `1px solid ${hairline}`,
        borderRadius: "4px",
        padding: "2px 8px",
        fontSize: "11px",
        cursor: "pointer",
      },
      ".cm-search .cm-button:hover": {
        backgroundColor: v("--surface-strong", "#e6e5e0") + "80",
      },
      ".cm-search label": { fontSize: "11px", color: muted },
      ".cm-panel.cm-search [name=close]": {
        color: muted,
        cursor: "pointer",
        fontSize: "16px",
      },
    },
    { dark: false },
  );

  // Syntax tokens read from --syntax-* with the chrome palette as fallback —
  // so themes that don't bother to override a given slot stay legible.
  const sx = (name: string, fallback: string) => v(`--syntax-${name}`, fallback);

  const highlight = HighlightStyle.define([
    { tag: [t.comment, t.lineComment, t.blockComment], color: sx("comment", mutedSoft), fontStyle: "italic" },
    { tag: t.docComment, color: sx("doc-comment", mutedSoft), fontStyle: "italic" },
    { tag: [t.keyword, t.modifier, t.self], color: sx("keyword", ink), fontWeight: "600" },
    { tag: [t.controlKeyword, t.operatorKeyword], color: sx("control-keyword", ink), fontWeight: "600" },
    { tag: t.operator, color: sx("operator", muted) },
    { tag: [t.string, t.special(t.string)], color: sx("string", "#b9722a") },
    { tag: t.regexp, color: sx("regex", "#b9722a") },
    { tag: t.escape, color: sx("escape", "#b9722a") },
    { tag: [t.number, t.integer, t.float], color: sx("number", "#1f8a65") },
    { tag: [t.bool, t.null], color: sx("bool", "#1f8a65") },
    { tag: t.atom, color: sx("atom", "#1f8a65") },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: sx("function", ink) },
    { tag: t.propertyName, color: sx("property-name", body) },
    { tag: [t.variableName], color: sx("variable", body) },
    { tag: t.definition(t.variableName), color: sx("definition", ink) },
    { tag: [t.typeName], color: sx("type", ink), fontWeight: "500" },
    { tag: [t.className], color: sx("class-name", ink), fontWeight: "500" },
    { tag: t.namespace, color: sx("namespace", ink) },
    { tag: [t.tagName, t.angleBracket], color: sx("tag", "#cf2d56") },
    { tag: t.attributeName, color: sx("attribute-name", muted) },
    { tag: t.attributeValue, color: sx("attribute-value", "#b9722a") },
    { tag: [t.punctuation, t.separator], color: sx("punctuation", muted) },
    { tag: [t.bracket, t.brace, t.paren, t.squareBracket], color: sx("bracket", muted) },
    { tag: t.heading, color: sx("heading", ink), fontWeight: "600" },
    { tag: [t.link, t.url], color: sx("link", "#b9722a"), textDecoration: "underline" },
    { tag: t.strong, fontWeight: "600" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.invalid, color: sx("invalid", "#cf2d56") },
  ]);

  return [theme, syntaxHighlighting(highlight)];
}
