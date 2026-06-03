import { ext } from "@/lib/path";

/** File-backed tab kinds, decided purely from the filename extension. */
export type FileKind = "markdown" | "image" | "pdf" | "editor";

const MARKDOWN_EXTS = ["md", "mdx", "markdown"];
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

/**
 * Map a filename to the tab kind that should render it. Single source of truth
 * shared by the project-open path (`AppShell.handleOpenFile`) and the preview-open
 * path (`AppShell.handleOpenPreviewFile`).
 */
export function fileKindFor(name: string): FileKind {
  const e = ext(name);
  if (MARKDOWN_EXTS.includes(e)) return "markdown";
  if (IMAGE_EXTS.includes(e)) return "image";
  if (e === "pdf") return "pdf";
  return "editor";
}
