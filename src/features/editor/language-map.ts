import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

import { astroLanguage } from "./grammars/astro";

type Loader = () => Promise<Extension>;

/**
 * Dynamic CodeMirror language loaders keyed by file extension. Each entry is a
 * dynamic `import()` so the language code is split into its own chunk — opening
 * a `.rs` file pays for the Rust parser exactly once, the first time.
 *
 * Coverage:
 *   - First-party `@codemirror/lang-*` for actively-maintained grammars
 *   - `@codemirror/legacy-modes` (a single dep, many sub-paths) for the
 *     classic CodeMirror 5 modes still used for Shell/TOML/Dockerfile/Ruby/etc.
 *   - HTML as a shared fallback for `.astro`/`.vue` template-heavy formats when
 *     no dedicated grammar is loaded (Vue and Angular have real ones below).
 */

// First-party CodeMirror 6 grammars.
const ts = () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true }));
const tsx = () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true, typescript: true }));
const js = () => import("@codemirror/lang-javascript").then((m) => m.javascript());
const jsx = () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true }));
const json = () => import("@codemirror/lang-json").then((m) => m.json());
const md = () => import("@codemirror/lang-markdown").then((m) => m.markdown());
const html = () => import("@codemirror/lang-html").then((m) => m.html());
const css = () => import("@codemirror/lang-css").then((m) => m.css());
const py = () => import("@codemirror/lang-python").then((m) => m.python());
const rust = () => import("@codemirror/lang-rust").then((m) => m.rust());
const go = () => import("@codemirror/lang-go").then((m) => m.go());
const yaml = () => import("@codemirror/lang-yaml").then((m) => m.yaml());
const sql = () => import("@codemirror/lang-sql").then((m) => m.sql());
const cpp = () => import("@codemirror/lang-cpp").then((m) => m.cpp());
const java = () => import("@codemirror/lang-java").then((m) => m.java());
const php = () => import("@codemirror/lang-php").then((m) => m.php());
const sass = () => import("@codemirror/lang-sass").then((m) => m.sass());
const less = () => import("@codemirror/lang-less").then((m) => m.less());
const vue = () => import("@codemirror/lang-vue").then((m) => m.vue());
const angular = () => import("@codemirror/lang-angular").then((m) => m.angular());

// CM5 legacy modes — wrapped in StreamLanguage. Each import is a static path
// so Vite can resolve and code-split them (a dynamic template would need to be
// served at runtime and would break under tauri://).
const shell = () =>
  import("@codemirror/legacy-modes/mode/shell").then((m) => StreamLanguage.define(m.shell));
const toml = () =>
  import("@codemirror/legacy-modes/mode/toml").then((m) => StreamLanguage.define(m.toml));
const dockerfile = () =>
  import("@codemirror/legacy-modes/mode/dockerfile").then((m) => StreamLanguage.define(m.dockerFile));
const ruby = () =>
  import("@codemirror/legacy-modes/mode/ruby").then((m) => StreamLanguage.define(m.ruby));
const swift = () =>
  import("@codemirror/legacy-modes/mode/swift").then((m) => StreamLanguage.define(m.swift));
const kotlin = () =>
  import("@codemirror/legacy-modes/mode/clike").then((m) => StreamLanguage.define(m.kotlin));
const scala = () =>
  import("@codemirror/legacy-modes/mode/clike").then((m) => StreamLanguage.define(m.scala));
const dart = () =>
  import("@codemirror/legacy-modes/mode/clike").then((m) => StreamLanguage.define(m.dart));
const csharp = () =>
  import("@codemirror/legacy-modes/mode/clike").then((m) => StreamLanguage.define(m.csharp));
const lua = () =>
  import("@codemirror/legacy-modes/mode/lua").then((m) => StreamLanguage.define(m.lua));
const perl = () =>
  import("@codemirror/legacy-modes/mode/perl").then((m) => StreamLanguage.define(m.perl));
const haskell = () =>
  import("@codemirror/legacy-modes/mode/haskell").then((m) => StreamLanguage.define(m.haskell));
const erlang = () =>
  import("@codemirror/legacy-modes/mode/erlang").then((m) => StreamLanguage.define(m.erlang));
const r = () =>
  import("@codemirror/legacy-modes/mode/r").then((m) => StreamLanguage.define(m.r));
const properties = () =>
  import("@codemirror/legacy-modes/mode/properties").then((m) =>
    StreamLanguage.define(m.properties),
  );
const nginx = () =>
  import("@codemirror/legacy-modes/mode/nginx").then((m) => StreamLanguage.define(m.nginx));
const diff = () =>
  import("@codemirror/legacy-modes/mode/diff").then((m) => StreamLanguage.define(m.diff));

const map: Record<string, Loader> = {
  // JS / TS family
  ts, mts: ts, cts: ts,
  tsx,
  js, mjs: js, cjs: js,
  jsx,

  // Data / config
  json,
  jsonc: json,
  yaml,
  yml: yaml,
  toml,
  ini: properties,
  properties,
  env: properties,

  // Markup
  md, mdx: md, markdown: md,
  html, htm: html, xhtml: html, xml: html, svg: html,
  // Astro: dedicated mini-grammar that understands the `---` frontmatter as TS
  // and the rest as JSX-flavoured markup. See grammars/astro.ts.
  astro: () => Promise.resolve(astroLanguage()),
  // Svelte still falls back to HTML — its `<script>`/`<style>` block model is
  // closer to Vue's; revisit when we add a real grammar.
  svelte: html,
  vue,
  // Angular templates: real grammar.
  ng: angular,

  // Styling
  css,
  sass, scss: sass,
  less,

  // Systems / native
  rust, rs: rust,
  go,
  cpp, c: cpp, cc: cpp, cxx: cpp, h: cpp, hpp: cpp, hxx: cpp,
  cs: csharp,
  java,
  kt: kotlin, kts: kotlin,
  swift,
  scala,
  dart,

  // Scripting / functional
  py, pyi: py, pyx: py,
  rb: ruby, ruby,
  php, phtml: php,
  lua,
  pl: perl, pm: perl,
  hs: haskell, lhs: haskell,
  erl: erlang, hrl: erlang,
  r, R: r,

  // DB / query
  sql, psql: sql, mysql: sql,

  // Shell + ops
  sh: shell, bash: shell, zsh: shell, fish: shell, ksh: shell,
  dockerfile,
  containerfile: dockerfile,
  nginx, conf: nginx,
  diff, patch: diff,
};

export async function languageFor(ext: string): Promise<Extension | null> {
  const loader = map[ext.toLowerCase()];
  if (!loader) return null;
  try {
    return await loader();
  } catch (err) {
    console.warn(`[editor] failed to load language for .${ext}`, err);
    return null;
  }
}

/** Display labels for the status bar. Covers mapped languages plus a few common
 * extensions that don't have syntax highlighting wired yet. */
const LABELS: Record<string, string> = {
  ts: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  tsx: "TypeScript JSX",
  js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  jsx: "JavaScript JSX",
  json: "JSON", jsonc: "JSON",
  md: "Markdown", mdx: "MDX", markdown: "Markdown",
  html: "HTML", htm: "HTML", xhtml: "HTML",
  xml: "XML", svg: "SVG",
  astro: "Astro", vue: "Vue", svelte: "Svelte",
  ng: "Angular",
  css: "CSS", scss: "SCSS", sass: "Sass", less: "Less",
  py: "Python", pyi: "Python", pyx: "Python",
  rs: "Rust", rust: "Rust",
  go: "Go",
  c: "C", h: "C",
  cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++", hxx: "C++",
  cs: "C#",
  java: "Java",
  kt: "Kotlin", kts: "Kotlin",
  swift: "Swift",
  scala: "Scala",
  dart: "Dart",
  rb: "Ruby", ruby: "Ruby",
  php: "PHP", phtml: "PHP",
  lua: "Lua",
  pl: "Perl", pm: "Perl",
  hs: "Haskell", lhs: "Haskell",
  erl: "Erlang", hrl: "Erlang",
  r: "R", R: "R",
  sql: "SQL", psql: "PostgreSQL", mysql: "MySQL",
  yaml: "YAML", yml: "YAML",
  toml: "TOML",
  ini: "INI", properties: "Properties", env: "Env",
  sh: "Shell", bash: "Bash", zsh: "Zsh", fish: "Fish", ksh: "Ksh",
  dockerfile: "Dockerfile", containerfile: "Containerfile",
  nginx: "Nginx", conf: "Config",
  diff: "Diff", patch: "Patch",
  txt: "Texto",
};

/** Human-readable language label for the status bar. */
export function languageLabel(ext: string): string {
  const e = ext.toLowerCase();
  if (LABELS[e]) return LABELS[e];
  return e ? e.toUpperCase() : "Texto";
}
