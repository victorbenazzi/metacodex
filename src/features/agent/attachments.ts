import { fsApi } from "@/features/filesystem/filesystem.service";
import { useProjectsStore } from "@/features/projects/project.store";

/**
 * Attachment helpers for the Agent composer: classify picked/dropped/pasted
 * paths, load image bytes into data URLs, and materialize the pending
 * attachments into the opencode message `parts` the chat store POSTs. Pure
 * data + thin fsApi calls; all UI state lives in `composer.store`.
 */

/** A `parts[]` entry as opencode's `POST /session/{id}/message` accepts it. */
export type OutgoingPart =
  | { type: "text"; text: string }
  | { type: "file"; mime: string; filename: string; url: string };

export type AttachmentStatus = "loading" | "ready" | "error";

export type PendingAttachment =
  | {
      id: string;
      kind: "image";
      source: "path" | "paste";
      path?: string;
      filename: string;
      mime: string;
      /** `data:<mime>;base64,...`, doubles as the chip thumbnail src. */
      dataUrl: string;
      status: AttachmentStatus;
      error?: string;
    }
  | {
      id: string;
      kind: "file";
      path: string;
      filename: string;
      isDir: boolean;
      /** Inside a registered project root → attach by file:// URL (opencode
       *  reads it server-side); outside → inlined at send time. */
      insideRoots: boolean;
      status: AttachmentStatus;
      error?: string;
    }
  | { id: string; kind: "context-branch"; root: string; branch: string }
  | { id: string; kind: "context-chat"; sessionId: string; title: string }
  | { id: string; kind: "context-symbol"; name: string; path: string; line: number };

/** Images above this are rejected, a truncated image is garbage to a model. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Inlined text (outside-roots files, past-chat context) is capped here. */
const MAX_INLINE_TEXT_BYTES = 256 * 1024;

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

/** Manual mirror of `fs_ops::PREVIEW_TEXT_EXTS` (Rust is the authority when the
 *  bytes are actually read). Used to flag outside-roots attachments the send
 *  path could never inline, at ATTACH time instead of silently dropping later. */
const TEXT_EXTS = new Set([
  "md", "markdown", "mdx", "txt", "text", "log", "rst", "adoc", "json", "jsonc", "toml", "yaml",
  "yml", "ini", "conf", "env", "csv", "tsv", "xml", "html", "htm", "css", "scss", "sass", "less",
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "vue", "svelte", "py", "rs", "go", "rb", "php", "java",
  "kt", "swift", "c", "h", "cpp", "hpp", "cc", "cs", "sh", "bash", "zsh", "fish", "sql", "graphql",
  "gql", "lua", "r", "dart", "scala", "clj", "ex", "exs", "erl", "hs", "ml",
]);

export function isInlineableTextPath(path: string): boolean {
  return TEXT_EXTS.has(ext(path));
}

/** Best-effort mime for a file riding as a `file://` reference, so opencode
 *  gets an honest hint instead of a hardcoded text/plain for every binary. */
function fileMime(path: string): string {
  const e = ext(path);
  if (IMAGE_MIME_BY_EXT[e]) return IMAGE_MIME_BY_EXT[e];
  if (e === "pdf") return "application/pdf";
  if (TEXT_EXTS.has(e)) return "text/plain";
  return "application/octet-stream";
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function ext(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(ext(path));
}

/** Whether `path` sits under any registered project root (lexical check; the
 *  Rust roots guard is still the authority when bytes are actually read). */
export function isInsideRoots(path: string): boolean {
  return useProjectsStore
    .getState()
    .projects.some((p) => path === p.path || path.startsWith(p.path.endsWith("/") ? p.path : `${p.path}/`));
}

/**
 * Read an image into a data URL. Roots-checked read first; outside any project
 * root, fall back to the preview read (extension-allowlisted on the Rust side).
 */
export async function loadImageDataUrl(
  path: string,
): Promise<{ ok: true; mime: string; dataUrl: string } | { ok: false; error: "too-large" | "unsupported" | "read-failed" }> {
  let file;
  try {
    file = await fsApi.readFileBytes(path, MAX_IMAGE_BYTES);
  } catch (e) {
    if (errCode(e) === "PathNotAllowed") {
      try {
        file = await fsApi.readPreviewBytes(path, MAX_IMAGE_BYTES);
      } catch {
        return { ok: false, error: "unsupported" };
      }
    } else {
      return { ok: false, error: "read-failed" };
    }
  }
  if (file.truncated) return { ok: false, error: "too-large" };
  const mime = file.mime ?? IMAGE_MIME_BY_EXT[ext(path)] ?? "application/octet-stream";
  return { ok: true, mime, dataUrl: `data:${mime};base64,${file.b64}` };
}

function errCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e) return String((e as { code: unknown }).code);
  return undefined;
}

/**
 * Materialize pending attachments into outgoing message parts. File parts go
 * FIRST, synthetic context text parts after, the user's own text part is
 * appended by the caller, matching the opencode CLI's ordering.
 *
 * Context kinds (branch / past chat) are resolved by the caller-provided
 * builders so this module stays free of git/session I/O.
 */
export async function buildOutgoingParts(
  attachments: PendingAttachment[],
  resolvers: {
    branchContext?: (root: string, branch: string) => Promise<string | null>;
    chatContext?: (sessionId: string, title: string) => Promise<string | null>;
    symbolContext?: (name: string, path: string, line: number) => Promise<string | null>;
  } = {},
): Promise<OutgoingPart[]> {
  const fileParts: OutgoingPart[] = [];
  const contextParts: OutgoingPart[] = [];

  for (const a of attachments) {
    if (a.kind === "image") {
      if (a.status !== "ready" || !a.dataUrl) continue;
      fileParts.push({ type: "file", mime: a.mime, filename: a.filename, url: a.dataUrl });
      continue;
    }
    if (a.kind === "file") {
      if (a.status === "error") continue;
      if (a.isDir) {
        fileParts.push({
          type: "file",
          mime: "application/x-directory",
          filename: a.filename,
          url: `file://${a.path}`,
        });
      } else if (a.insideRoots) {
        fileParts.push({
          type: "file",
          mime: fileMime(a.path),
          filename: a.filename,
          url: `file://${a.path}`,
        });
      } else {
        // Outside every project root: inline the content so behavior stays
        // predictable for allowlisted preview files. Non-text extensions never
        // reach here: the composer flags them "unsupported" at attach time.
        try {
          const text = await fsApi.readPreviewText(a.path, MAX_INLINE_TEXT_BYTES);
          const suffix = text.truncated ? "\n\n[truncated]" : "";
          fileParts.push({
            type: "file",
            mime: "text/plain",
            filename: a.filename,
            url: `data:text/plain;base64,${toBase64Utf8(text.content + suffix)}`,
          });
        } catch {
          // unreadable after all (perms, vanished file): drop, the error
          // banner on the send covers user feedback
        }
      }
      continue;
    }
    if (a.kind === "context-branch" && resolvers.branchContext) {
      const text = await resolvers.branchContext(a.root, a.branch);
      if (text) contextParts.push({ type: "text", text });
      continue;
    }
    if (a.kind === "context-chat" && resolvers.chatContext) {
      const text = await resolvers.chatContext(a.sessionId, a.title);
      if (text) contextParts.push({ type: "text", text });
      continue;
    }
    if (a.kind === "context-symbol" && resolvers.symbolContext) {
      const text = await resolvers.symbolContext(a.name, a.path, a.line);
      if (text) contextParts.push({ type: "text", text });
    }
  }

  return [...fileParts, ...contextParts];
}

/** Base64 for arbitrary UTF-8 (btoa alone chokes on non-Latin-1). */
function toBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
