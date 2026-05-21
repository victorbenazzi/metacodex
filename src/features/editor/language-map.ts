import type { Extension } from "@codemirror/state";

type Loader = () => Promise<Extension>;

/**
 * Dynamic CodeMirror language loaders keyed by file extension. Languages are
 * imported lazily so the initial bundle stays small.
 */
const map: Record<string, Loader> = {
  ts: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  tsx: () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true, typescript: true })),
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  jsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  mjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  cjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  md: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  mdx: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  htm: () => import("@codemirror/lang-html").then((m) => m.html()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  scss: () => import("@codemirror/lang-css").then((m) => m.css()),
  py: () => import("@codemirror/lang-python").then((m) => m.python()),
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
