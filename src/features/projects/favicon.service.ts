import { CMD, invoke } from "@/lib/ipc";
import { fsApi } from "@/features/filesystem/filesystem.service";

export interface FaviconCandidate {
  /** Absolute path on disk. Used as the storage key (`favicon:<path>`). */
  path: string;
  /** Display label like "favicon.png" or "public/favicon.svg". */
  relPath: string;
  /** MIME hint from the backend. */
  mime: string;
}

/**
 * `favicon:<absolute-path>` is the storage form for a project icon that
 * points at the project's own favicon. Anything else is a Lucide icon name.
 */
export const FAVICON_PREFIX = "favicon:";

export function isFaviconIcon(value: string): boolean {
  return value.startsWith(FAVICON_PREFIX);
}

export function faviconPath(value: string): string | null {
  return value.startsWith(FAVICON_PREFIX) ? value.slice(FAVICON_PREFIX.length) : null;
}

export function toFaviconIcon(absPath: string): string {
  return `${FAVICON_PREFIX}${absPath}`;
}

// Module-scoped cache of data URIs keyed by absolute path. Favicons are small
// (typically < 50 KB) and we keep at most one per project, so unbounded growth
// isn't a concern in practice.
const dataUriCache = new Map<string, string>();

export const faviconApi = {
  detect(projectId: string): Promise<FaviconCandidate[]> {
    return invoke<FaviconCandidate[]>(CMD.detectProjectFavicons, { projectId });
  },

  async loadDataUri(absPath: string, mimeHint?: string): Promise<string> {
    const cached = dataUriCache.get(absPath);
    if (cached) return cached;
    const file = await fsApi.readFileBytes(absPath, 512 * 1024);
    const mime = file.mime ?? mimeHint ?? "image/png";
    const uri = `data:${mime};base64,${file.b64}`;
    dataUriCache.set(absPath, uri);
    return uri;
  },

  evict(absPath: string): void {
    dataUriCache.delete(absPath);
  },

  /** Drop all cached data URIs. Useful when projects are removed or renamed. */
  clear(): void {
    dataUriCache.clear();
  },
};
