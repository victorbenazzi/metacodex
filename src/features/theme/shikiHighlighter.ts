import type { BundledLanguage, Highlighter } from "shiki";

import { getShikiTheme } from "./shikiTheme";
import type { Theme } from "./types";

/**
 * Lazy singleton Shiki highlighter shared by every MarkdownPreview instance.
 * The first `highlight()` call loads the engine + the seed language; subsequent
 * languages and themes are loaded on demand so the cold start stays small.
 *
 * Shiki's bundle is ~MB; importing it from a module that's part of the boot
 * graph would bloat first paint, so we only `import('shiki')` from the lazy
 * `ensureHighlighter()` path, triggered by the first ``` block to render.
 */

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();
const loadedThemes = new Set<string>();

/** Languages Shiki supports out of the box that we want available. Anything not
 *  on this list will fall back to `text` (plain monospace, no colours). */
const SEED_LANG: BundledLanguage = "typescript";

const KNOWN_LANGS: ReadonlySet<string> = new Set<BundledLanguage>([
  "typescript", "tsx", "javascript", "jsx",
  "python", "rust", "go", "java", "ruby", "swift", "kotlin",
  "json", "yaml", "toml", "xml", "html", "css", "scss", "sass",
  "bash", "shell", "shellscript", "fish", "powershell",
  "markdown", "md", "mdx",
  "sql", "graphql", "diff", "dockerfile", "ini",
  "vue", "svelte", "astro",
  "c", "cpp", "csharp", "objective-c",
  "lua", "perl", "php", "elixir", "erlang", "haskell",
] as BundledLanguage[]);

/** Map common aliases (e.g. `sh`, `ts`) to their canonical Shiki names. */
const ALIASES: Record<string, BundledLanguage> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  dockerfile: "docker",
};

function normalizeLang(lang: string | undefined): BundledLanguage | "text" {
  if (!lang) return "text";
  const lower = lang.toLowerCase();
  const canonical = (ALIASES[lower] ?? lower) as BundledLanguage;
  return KNOWN_LANGS.has(canonical) ? canonical : "text";
}

async function ensureHighlighter(): Promise<Highlighter> {
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = (async () => {
    const { createHighlighter } = await import("shiki");
    const h = await createHighlighter({
      themes: [],
      langs: [SEED_LANG],
    });
    loadedLangs.add(SEED_LANG);
    return h;
  })();
  return highlighterPromise;
}

async function ensureLang(h: Highlighter, lang: BundledLanguage | "text"): Promise<void> {
  if (lang === "text" || loadedLangs.has(lang)) return;
  await h.loadLanguage(lang);
  loadedLangs.add(lang);
}

async function ensureTheme(h: Highlighter, theme: Theme): Promise<string> {
  const name = `mcx-${theme.id}`;
  if (!loadedThemes.has(theme.id)) {
    await h.loadTheme(getShikiTheme(theme));
    loadedThemes.add(theme.id);
  }
  return name;
}

/**
 * Render `code` to a coloured HTML string for `theme`. Returns null while the
 * engine is still loading on the very first call; the caller should fall back
 * to plain `<pre>` text in that window (sub-second on a warm cache).
 */
export async function highlightToHtml(
  code: string,
  langHint: string | undefined,
  theme: Theme,
): Promise<string> {
  const h = await ensureHighlighter();
  const lang = normalizeLang(langHint);
  await ensureLang(h, lang);
  const themeName = await ensureTheme(h, theme);
  return h.codeToHtml(code, { lang, theme: themeName });
}

/**
 * Token-level variant of `highlightToHtml` for consumers that render their own
 * DOM. Shares the same engine, language cache and token-driven theme.
 */
export async function highlightToTokens(
  code: string,
  langHint: string | undefined,
  theme: Theme,
): Promise<import("shiki").TokensResult> {
  const h = await ensureHighlighter();
  const lang = normalizeLang(langHint);
  await ensureLang(h, lang);
  const themeName = await ensureTheme(h, theme);
  return h.codeToTokens(code, { lang, theme: themeName });
}

/** Whether a fence language will get real colours (vs the `text` fallback). */
export function isHighlightableLang(lang: string | undefined): boolean {
  return normalizeLang(lang) !== "text";
}

/** The canonical language list (for plugin capability reporting). */
export function supportedHighlightLangs(): string[] {
  return [...KNOWN_LANGS];
}
