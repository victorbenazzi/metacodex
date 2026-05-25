import type { ThemeRegistrationRaw } from "shiki";

import type { Theme } from "./types";

/**
 * Convert a metacodex Theme into a Shiki ThemeRegistration (TextMate-style).
 * Mapping is conservative: every scope we care about resolves to one of the
 * `syntax.*` slots so a single palette swap recolors *both* the CodeMirror
 * editor and the Shiki-rendered markdown blocks. Scopes we don't map fall back
 * to `editor.foreground` (= theme.chrome.ink) — never a hardcoded colour.
 *
 * Memoized by theme id so repeated lookups (the markdown preview re-renders on
 * every keystroke in source mode) don't rebuild the JSON.
 */
const cache = new Map<string, ThemeRegistrationRaw>();

export function getShikiTheme(theme: Theme): ThemeRegistrationRaw {
  const hit = cache.get(theme.id);
  if (hit) return hit;
  const built = buildShikiTheme(theme);
  cache.set(theme.id, built);
  return built;
}

function buildShikiTheme(theme: Theme): ThemeRegistrationRaw {
  const { chrome, syntax } = theme;
  return {
    name: `mcx-${theme.id}`,
    type: theme.kind,
    colors: {
      "editor.background": chrome.canvasSoft,
      "editor.foreground": chrome.ink,
      "editor.lineHighlightBackground": chrome.surfaceStrong,
      "editorLineNumber.foreground": chrome.mutedSoft,
      "editorLineNumber.activeForeground": chrome.body,
      "editor.selectionBackground": chrome.selection,
    },
    settings: [
      { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: syntax.comment, fontStyle: "italic" } },
      { scope: ["comment.block.documentation"], settings: { foreground: syntax.docComment, fontStyle: "italic" } },
      { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: syntax.keyword, fontStyle: "bold" } },
      { scope: ["keyword.control", "keyword.operator.expression"], settings: { foreground: syntax.controlKeyword, fontStyle: "bold" } },
      { scope: ["keyword.operator", "punctuation.accessor"], settings: { foreground: syntax.operator } },
      { scope: ["string", "string.quoted"], settings: { foreground: syntax.string } },
      { scope: ["string.regexp"], settings: { foreground: syntax.regex } },
      { scope: ["constant.character.escape"], settings: { foreground: syntax.escape } },
      { scope: ["constant.numeric"], settings: { foreground: syntax.number } },
      { scope: ["constant.language.boolean", "constant.language.null", "constant.language.undefined"], settings: { foreground: syntax.bool } },
      { scope: ["constant.language", "constant.other"], settings: { foreground: syntax.atom } },
      { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: syntax.function } },
      { scope: ["meta.method.declaration entity.name.function", "entity.name.function.member"], settings: { foreground: syntax.method } },
      { scope: ["variable.other.property", "support.type.property-name"], settings: { foreground: syntax.propertyName } },
      { scope: ["variable", "variable.other"], settings: { foreground: syntax.variable } },
      { scope: ["variable.parameter"], settings: { foreground: syntax.parameter } },
      { scope: ["variable.other.constant", "entity.name.constant"], settings: { foreground: syntax.definition } },
      { scope: ["entity.name.type", "support.type"], settings: { foreground: syntax.type } },
      { scope: ["entity.name.class", "entity.other.inherited-class"], settings: { foreground: syntax.className } },
      { scope: ["entity.name.namespace", "entity.name.module"], settings: { foreground: syntax.namespace } },
      { scope: ["entity.name.tag"], settings: { foreground: syntax.tag } },
      { scope: ["entity.other.attribute-name"], settings: { foreground: syntax.attributeName } },
      { scope: ["string.quoted.double.html", "meta.attribute string"], settings: { foreground: syntax.attributeValue } },
      { scope: ["punctuation"], settings: { foreground: syntax.punctuation } },
      { scope: ["punctuation.section", "meta.brace", "meta.bracket"], settings: { foreground: syntax.bracket } },
      { scope: ["markup.heading"], settings: { foreground: syntax.heading, fontStyle: "bold" } },
      { scope: ["markup.underline.link", "markup.link"], settings: { foreground: syntax.link, fontStyle: "underline" } },
      { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
      { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
      { scope: ["invalid", "invalid.illegal"], settings: { foreground: syntax.invalid } },
    ],
  };
}
