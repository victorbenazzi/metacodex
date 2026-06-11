import { qsx } from "./oc";

/**
 * Harness-side search for the "@" autocomplete (`/find/file`, `/find/symbol`):
 * the same results the agent's own tools see, with the harness's ignore rules
 * applied. Both throw on a non-OK response so the popup owns the fallback
 * (the Rust `list_files` path for files; a calm empty state for symbols,
 * which have no local equivalent).
 */

const FILE_LIMIT = 50;

/** Fuzzy file/dir paths, server-ranked, RELATIVE to `directory`. */
export async function findFiles(
  base: string,
  directory: string | null,
  query: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await fetch(
    `${base}/find/file${qsx(directory, { query, limit: String(FILE_LIMIT) })}`,
    { signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as unknown;
  return Array.isArray(rows) ? rows.filter((r): r is string => typeof r === "string") : [];
}

export interface SymbolHit {
  name: string;
  /** LSP SymbolKind number (unused for now beyond identity). */
  kind: number;
  /** Absolute path, resolved from the `file://` location URI. */
  path: string;
  /** 0-based line of the symbol's range start. */
  line: number;
}

/** Workspace symbols via the harness's LSP (`[]` while no server is warm). */
export async function findSymbols(
  base: string,
  directory: string | null,
  query: string,
  signal?: AbortSignal,
): Promise<SymbolHit[]> {
  const res = await fetch(`${base}/find/symbol${qsx(directory, { query })}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows)) return [];
  const out: SymbolHit[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const name = typeof r.name === "string" ? r.name : "";
    const loc = r.location as
      | { uri?: string; range?: { start?: { line?: number } } }
      | undefined;
    const uri = loc?.uri ?? "";
    if (!name || !uri) continue;
    out.push({
      name,
      kind: typeof r.kind === "number" ? r.kind : 0,
      path: uri.startsWith("file://") ? decodeURIComponent(uri.slice("file://".length)) : uri,
      line: loc?.range?.start?.line ?? 0,
    });
  }
  return out;
}
