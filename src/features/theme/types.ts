/**
 * Theme schema. A theme is a self-contained palette covering chrome (UI), syntax
 * (code highlighting) and terminal (ANSI). Applying a theme writes every entry
 * here as a CSS custom property on the document root — components keep reading
 * from `var(--*)` without knowing which theme is active.
 *
 * Keep this in sync with the default vars declared in `src/styles/tokens.css`.
 * The kebab-case CSS variable name is derived from the camelCase key in
 * `applyTheme.ts` (e.g. `surfaceCard` → `--surface-card`, `syntax.string` →
 * `--syntax-string`, `terminal.brightBlue` → `--term-bright-blue`).
 */

export type ThemeKind = "light" | "dark";

export interface ThemeChrome {
  canvas: string;
  canvasSoft: string;
  surfaceCard: string;
  surfaceStrong: string;

  hairline: string;
  hairlineSoft: string;
  hairlineStrong: string;

  ink: string;
  body: string;
  muted: string;
  mutedSoft: string;

  primary: string;
  primaryActive: string;
  onPrimary: string;

  success: string;
  danger: string;
  warn: string;

  diffAdd: string;
  diffModify: string;
  diffRemove: string;
  diffAddLine: string;
  diffAddText: string;
  diffRemoveLine: string;
  diffRemoveText: string;

  /** Selection background used by both the editor and the terminal. */
  selection: string;
  /** High-contrast scrollbar thumb for the tab strip. */
  scrollbarTabThumb: string;
}

export interface ThemeSyntax {
  /** General `let`/`const`/`function`/`class` and control flow keywords. */
  keyword: string;
  controlKeyword: string;
  operator: string;

  string: string;
  regex: string;
  escape: string;

  number: string;
  bool: string;
  atom: string;

  comment: string;
  docComment: string;

  function: string;
  method: string;
  propertyName: string;

  variable: string;
  parameter: string;
  definition: string;

  type: string;
  className: string;
  namespace: string;

  tag: string;
  attributeName: string;
  attributeValue: string;

  punctuation: string;
  bracket: string;

  link: string;
  heading: string;

  invalid: string;
}

export interface ThemeTerminal {
  bg: string;
  fg: string;
  cursor: string;
  selection: string;

  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;

  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface Theme {
  /** Stable id stored in settings (`solar-cream`, `tokyo-night`, …). */
  id: string;
  /** Display name. Surfaced as-is in the picker; not translated. */
  name: string;
  kind: ThemeKind;
  chrome: ThemeChrome;
  syntax: ThemeSyntax;
  terminal: ThemeTerminal;
}
