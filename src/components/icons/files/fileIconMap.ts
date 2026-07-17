import {
  Binary,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileKey,
  FileLock2,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileType2,
  FileVideo,
  Hash,
  type IconComponent,
} from "@/components/ui/icons";
import {
  siAngular,
  siApache,
  siAstro,
  siBabel,
  siBun,
  siClojure,
  siCmake,
  siCplusplus,
  siCrystal,
  siCss,
  siCypress,
  siDart,
  siDeno,
  siDocker,
  siEditorconfig,
  siElixir,
  siErlang,
  siEsbuild,
  siEslint,
  siGit,
  siGnubash,
  siGo,
  siGraphql,
  siHaskell,
  siHtml5,
  siJavascript,
  siJest,
  siJulia,
  siJupyter,
  siKotlin,
  siLess,
  siLua,
  siMarkdown,
  siMdx,
  siNextdotjs,
  siNginx,
  siNim,
  siNodedotjs,
  siNpm,
  siNuxt,
  siNx,
  siOcaml,
  siPerl,
  siPhp,
  siPnpm,
  siPostcss,
  siPrettier,
  siPrisma,
  siPython,
  siQwik,
  siR,
  siReact,
  siRemix,
  siRollupdotjs,
  siRuby,
  siRust,
  siSass,
  siScala,
  siSolid,
  siStorybook,
  siSupabase,
  siSvelte,
  siSwift,
  siTailwindcss,
  siTerraform,
  siTurborepo,
  siTypescript,
  siVercel,
  siVite,
  siVitest,
  siVuedotjs,
  siWebassembly,
  siWebpack,
  siYaml,
  siYarn,
  siZig,
  type SimpleIcon,
} from "simple-icons";

import { basename, ext } from "@/lib/path";

export type FileIconEntry =
  | { kind: "brand"; icon: SimpleIcon }
  | { kind: "glyph"; icon: IconComponent };

const brand = (icon: SimpleIcon): FileIconEntry => ({ kind: "brand", icon });
const glyph = (icon: IconComponent): FileIconEntry => ({ kind: "glyph", icon });

/** Exact filename match (case-insensitive). Highest priority — beats both
 *  glob patterns and the extension map. */
const BY_FILENAME: Record<string, FileIconEntry> = {
  // Package managers / lockfiles
  "package.json": brand(siNpm),
  "package-lock.json": brand(siNpm),
  ".npmrc": brand(siNpm),
  ".nvmrc": brand(siNodedotjs),
  "node-version": brand(siNodedotjs),
  ".node-version": brand(siNodedotjs),
  "pnpm-lock.yaml": brand(siPnpm),
  "pnpm-workspace.yaml": brand(siPnpm),
  ".pnpmfile.cjs": brand(siPnpm),
  "yarn.lock": brand(siYarn),
  ".yarnrc": brand(siYarn),
  ".yarnrc.yml": brand(siYarn),
  "bun.lock": brand(siBun),
  "bun.lockb": brand(siBun),
  "bunfig.toml": brand(siBun),
  "deno.json": brand(siDeno),
  "deno.jsonc": brand(siDeno),
  "deno.lock": brand(siDeno),

  // Build / bundler configs
  "tsconfig.json": brand(siTypescript),
  "tailwind.config.js": brand(siTailwindcss),
  "tailwind.config.ts": brand(siTailwindcss),
  "tailwind.config.cjs": brand(siTailwindcss),
  "tailwind.config.mjs": brand(siTailwindcss),
  "postcss.config.js": brand(siPostcss),
  "postcss.config.cjs": brand(siPostcss),
  "postcss.config.mjs": brand(siPostcss),
  "vite.config.js": brand(siVite),
  "vite.config.ts": brand(siVite),
  "vite.config.mjs": brand(siVite),
  "webpack.config.js": brand(siWebpack),
  "webpack.config.ts": brand(siWebpack),
  "rollup.config.js": brand(siRollupdotjs),
  "rollup.config.ts": brand(siRollupdotjs),
  "rollup.config.mjs": brand(siRollupdotjs),
  "esbuild.config.js": brand(siEsbuild),
  "esbuild.config.ts": brand(siEsbuild),
  "babel.config.js": brand(siBabel),
  "babel.config.cjs": brand(siBabel),
  "babel.config.json": brand(siBabel),
  ".babelrc": brand(siBabel),
  ".babelrc.js": brand(siBabel),
  ".babelrc.json": brand(siBabel),

  // Linters / formatters
  ".eslintrc": brand(siEslint),
  ".eslintrc.js": brand(siEslint),
  ".eslintrc.cjs": brand(siEslint),
  ".eslintrc.json": brand(siEslint),
  ".eslintrc.yml": brand(siEslint),
  ".eslintignore": brand(siEslint),
  "eslint.config.js": brand(siEslint),
  "eslint.config.mjs": brand(siEslint),
  "eslint.config.ts": brand(siEslint),
  ".prettierrc": brand(siPrettier),
  ".prettierrc.js": brand(siPrettier),
  ".prettierrc.cjs": brand(siPrettier),
  ".prettierrc.json": brand(siPrettier),
  ".prettierrc.yaml": brand(siPrettier),
  ".prettierrc.yml": brand(siPrettier),
  ".prettierignore": brand(siPrettier),
  "prettier.config.js": brand(siPrettier),

  // Framework configs
  "next.config.js": brand(siNextdotjs),
  "next.config.mjs": brand(siNextdotjs),
  "next.config.ts": brand(siNextdotjs),
  "nuxt.config.js": brand(siNuxt),
  "nuxt.config.ts": brand(siNuxt),
  "astro.config.mjs": brand(siAstro),
  "astro.config.ts": brand(siAstro),
  "astro.config.js": brand(siAstro),
  "svelte.config.js": brand(siSvelte),
  "svelte.config.ts": brand(siSvelte),
  "vue.config.js": brand(siVuedotjs),
  "remix.config.js": brand(siRemix),
  "angular.json": brand(siAngular),
  "qwik.config.ts": brand(siQwik),
  "solid.config.ts": brand(siSolid),

  // Test runners
  "jest.config.js": brand(siJest),
  "jest.config.ts": brand(siJest),
  "jest.config.cjs": brand(siJest),
  "jest.config.mjs": brand(siJest),
  "vitest.config.js": brand(siVitest),
  "vitest.config.ts": brand(siVitest),
  "vitest.config.mjs": brand(siVitest),
  "playwright.config.js": glyph(FileTerminal),
  "playwright.config.ts": glyph(FileTerminal),
  "cypress.config.js": brand(siCypress),
  "cypress.config.ts": brand(siCypress),

  // Monorepo / tooling
  "turbo.json": brand(siTurborepo),
  "vercel.json": brand(siVercel),
  "nx.json": brand(siNx),
  "lerna.json": brand(siNpm),
  ".storybook": brand(siStorybook),

  // Docker
  dockerfile: brand(siDocker),
  "dockerfile.dev": brand(siDocker),
  "dockerfile.prod": brand(siDocker),
  ".dockerignore": brand(siDocker),
  "docker-compose.yml": brand(siDocker),
  "docker-compose.yaml": brand(siDocker),
  "compose.yml": brand(siDocker),
  "compose.yaml": brand(siDocker),

  // Git
  ".gitignore": brand(siGit),
  ".gitattributes": brand(siGit),
  ".gitmodules": brand(siGit),
  ".gitkeep": brand(siGit),

  // Language-specific entrypoints
  "cargo.toml": brand(siRust),
  "cargo.lock": brand(siRust),
  gemfile: brand(siRuby),
  "gemfile.lock": brand(siRuby),
  rakefile: brand(siRuby),
  pipfile: brand(siPython),
  "pipfile.lock": brand(siPython),
  "pyproject.toml": brand(siPython),
  "poetry.lock": brand(siPython),
  "requirements.txt": brand(siPython),
  "requirements-dev.txt": brand(siPython),
  "setup.py": brand(siPython),
  "setup.cfg": brand(siPython),
  "composer.json": brand(siPhp),
  "composer.lock": brand(siPhp),
  "go.mod": brand(siGo),
  "go.sum": brand(siGo),
  "mix.exs": brand(siElixir),
  "mix.lock": brand(siElixir),
  "shard.yml": brand(siCrystal),

  // Web servers
  "nginx.conf": brand(siNginx),
  ".htaccess": brand(siApache),

  // Backend / data
  "prisma.schema": brand(siPrisma),
  "schema.prisma": brand(siPrisma),
  "supabase.toml": brand(siSupabase),

  // CMake / build
  cmakelists: brand(siCmake),
  "cmakelists.txt": brand(siCmake),

  // Editor / repo metadata
  ".editorconfig": brand(siEditorconfig),

  // Generic infra
  makefile: glyph(FileCog),
  "rakefile.rb": brand(siRuby),
  "license": glyph(FileText),
  "license.md": glyph(FileText),
  "licence": glyph(FileText),
  "readme": brand(siMarkdown),
  "readme.md": brand(siMarkdown),
  "changelog": brand(siMarkdown),
  "changelog.md": brand(siMarkdown),
  "contributing.md": brand(siMarkdown),
  "code_of_conduct.md": brand(siMarkdown),
  "security.md": brand(siMarkdown),
};

/** Extension → entry. Lower priority than the filename map. */
const BY_EXTENSION: Record<string, FileIconEntry> = {
  // TypeScript / JavaScript
  ts: brand(siTypescript),
  mts: brand(siTypescript),
  cts: brand(siTypescript),
  "d.ts": brand(siTypescript),
  tsx: brand(siReact),
  js: brand(siJavascript),
  mjs: brand(siJavascript),
  cjs: brand(siJavascript),
  jsx: brand(siReact),

  // Frameworks / templating
  vue: brand(siVuedotjs),
  svelte: brand(siSvelte),
  astro: brand(siAstro),
  qwik: brand(siQwik),

  // Languages
  py: brand(siPython),
  pyi: brand(siPython),
  pyc: brand(siPython),
  rs: brand(siRust),
  go: brand(siGo),
  rb: brand(siRuby),
  erb: brand(siRuby),
  php: brand(siPhp),
  kt: brand(siKotlin),
  kts: brand(siKotlin),
  swift: brand(siSwift),
  dart: brand(siDart),
  ex: brand(siElixir),
  exs: brand(siElixir),
  erl: brand(siErlang),
  hrl: brand(siErlang),
  hs: brand(siHaskell),
  lhs: brand(siHaskell),
  clj: brand(siClojure),
  cljs: brand(siClojure),
  cljc: brand(siClojure),
  edn: brand(siClojure),
  ml: brand(siOcaml),
  mli: brand(siOcaml),
  scala: brand(siScala),
  sc: brand(siScala),
  lua: brand(siLua),
  cr: brand(siCrystal),
  nim: brand(siNim),
  zig: brand(siZig),
  r: brand(siR),
  rmd: brand(siR),
  jl: brand(siJulia),
  pl: brand(siPerl),
  pm: brand(siPerl),
  cpp: brand(siCplusplus),
  cxx: brand(siCplusplus),
  cc: brand(siCplusplus),
  hpp: brand(siCplusplus),
  hxx: brand(siCplusplus),

  // Web
  html: brand(siHtml5),
  htm: brand(siHtml5),
  css: brand(siCss),
  scss: brand(siSass),
  sass: brand(siSass),
  less: brand(siLess),

  // Markup / data
  md: brand(siMarkdown),
  markdown: brand(siMarkdown),
  mdx: brand(siMdx),
  // The official JSON sphere logo turns into a blob at 13px — use the
  // braces-file glyph instead. Same for XML's W3C wordmark, which is too thin.
  json: glyph(FileJson),
  jsonc: glyph(FileJson),
  json5: glyph(FileJson),
  yaml: brand(siYaml),
  yml: brand(siYaml),
  xml: glyph(FileCode),
  graphql: brand(siGraphql),
  gql: brand(siGraphql),

  // Shell / scripts
  sh: brand(siGnubash),
  bash: brand(siGnubash),
  zsh: brand(siGnubash),

  // Infra
  tf: brand(siTerraform),
  tfvars: brand(siTerraform),
  wasm: brand(siWebassembly),
  wat: brand(siWebassembly),

  // Notebooks
  ipynb: brand(siJupyter),

  // Plain glyph fallbacks for non-branded but well-known categories
  c: glyph(FileCode),
  h: glyph(FileCode),
  cs: glyph(FileCode),
  java: glyph(FileCode),
  fish: glyph(FileTerminal),
  ps1: glyph(FileTerminal),
  bat: glyph(FileTerminal),
  cmd: glyph(FileTerminal),

  // Config-ish
  toml: glyph(FileCog),
  ini: glyph(FileCog),
  conf: glyph(FileCog),
  cfg: glyph(FileCog),
  properties: glyph(FileCog),
  env: glyph(FileKey),

  // Docs / text
  txt: glyph(FileText),
  log: glyph(FileText),
  rst: glyph(FileText),
  rtf: glyph(FileText),

  // Images
  png: glyph(FileImage),
  jpg: glyph(FileImage),
  jpeg: glyph(FileImage),
  gif: glyph(FileImage),
  webp: glyph(FileImage),
  avif: glyph(FileImage),
  bmp: glyph(FileImage),
  ico: glyph(FileImage),
  svg: glyph(FileImage),
  heic: glyph(FileImage),

  // PDF / docs
  pdf: glyph(FileType2),
  doc: glyph(FileText),
  docx: glyph(FileText),

  // Spreadsheets
  csv: glyph(FileSpreadsheet),
  tsv: glyph(FileSpreadsheet),
  xls: glyph(FileSpreadsheet),
  xlsx: glyph(FileSpreadsheet),

  // Audio / video
  mp3: glyph(FileAudio),
  wav: glyph(FileAudio),
  ogg: glyph(FileAudio),
  flac: glyph(FileAudio),
  m4a: glyph(FileAudio),
  mp4: glyph(FileVideo),
  mov: glyph(FileVideo),
  mkv: glyph(FileVideo),
  webm: glyph(FileVideo),
  avi: glyph(FileVideo),

  // Archives
  zip: glyph(FileArchive),
  tar: glyph(FileArchive),
  gz: glyph(FileArchive),
  bz2: glyph(FileArchive),
  rar: glyph(FileArchive),
  "7z": glyph(FileArchive),

  // Fonts
  ttf: glyph(FileType),
  otf: glyph(FileType),
  woff: glyph(FileType),
  woff2: glyph(FileType),

  // Databases
  sql: glyph(Database),
  sqlite: glyph(Database),
  db: glyph(Database),

  // Binary / locks
  bin: glyph(Binary),
  exe: glyph(Binary),
  lock: glyph(FileLock2),

  // Stylesheets-ish
  styl: glyph(Hash),
};

/** Generic prefix patterns that the filename map can't express literally
 *  (e.g. `.env.local`, `.env.development.local`). Order matters — first match wins. */
const PREFIX_PATTERNS: { test: (lower: string) => boolean; entry: FileIconEntry }[] = [
  { test: (n) => n.startsWith(".env"), entry: glyph(FileKey) },
  { test: (n) => n.startsWith("dockerfile"), entry: brand(siDocker) },
  { test: (n) => n === "makefile" || n.startsWith("makefile."), entry: glyph(FileCog) },
];

const GENERIC_JSON = glyph(FileJson);
const GENERIC_FILE = glyph(File);

/** Resolve a filename to its icon entry. Pure / safe to call frequently —
 *  every map lookup is O(1) and the only fallback iteration is `PREFIX_PATTERNS`
 *  which is tiny. */
export function resolveFileIcon(filename: string): FileIconEntry {
  const lower = basename(filename).toLowerCase();

  const exact = BY_FILENAME[lower];
  if (exact) return exact;

  for (const p of PREFIX_PATTERNS) {
    if (p.test(lower)) return p.entry;
  }

  // Special case: `.d.ts` (TypeScript declaration) should beat plain `ts`.
  if (lower.endsWith(".d.ts")) return BY_EXTENSION["d.ts"]!;

  const extension = ext(filename);
  if (extension && BY_EXTENSION[extension]) return BY_EXTENSION[extension];

  // Dotfiles with no extension default to the generic JSON-y config look.
  if (lower.startsWith(".") && !extension) return GENERIC_JSON;

  return GENERIC_FILE;
}
