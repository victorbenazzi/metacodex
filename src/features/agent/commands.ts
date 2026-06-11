import { qs } from "./oc";
import { dirKey } from "./sessions.store";

/**
 * Custom-command catalog (`GET /command`), the executable side of the "/"
 * autocomplete. Commands are directory-scoped (project commands exist), so the
 * cache keys by directory. The catalog also carries the harness's view of
 * skills (`source: "skill"`); the popup filters those out (the Skills section
 * already lists them), but the send routing matches ANY name here, so a typed
 * `/name` runs through the server-side template expansion either way.
 *
 * No `chat.store` import (it imports us for the routing); callers pass
 * base/directory in.
 */

export interface CommandInfo {
  name: string;
  description?: string;
  agent?: string;
  /** "provider/model" string, the command's pinned model (if any). */
  model?: string;
  /** command | mcp | skill */
  source?: string;
}

const cacheByDir = new Map<string, CommandInfo[]>();
const inflightByDir = new Map<string, Promise<CommandInfo[]>>();

export function loadCommands(base: string, directory: string | null): Promise<CommandInfo[]> {
  const key = dirKey(directory);
  const hit = cacheByDir.get(key);
  if (hit) return Promise.resolve(hit);
  let inflight = inflightByDir.get(key);
  if (!inflight) {
    inflight = fetch(`${base}/command${qs(directory)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = (await res.json()) as unknown;
        const list = Array.isArray(rows)
          ? (rows as Array<Record<string, unknown>>)
              .filter((r) => typeof r.name === "string" && r.name)
              .map((r) => ({
                name: r.name as string,
                description: typeof r.description === "string" ? r.description : undefined,
                agent: typeof r.agent === "string" ? r.agent : undefined,
                model: typeof r.model === "string" ? r.model : undefined,
                source: typeof r.source === "string" ? r.source : undefined,
              }))
          : [];
        cacheByDir.set(key, list);
        return list;
      })
      .catch(() => {
        // Best-effort: a failed fetch resolves empty and clears the inflight
        // slot so the next open retries.
        inflightByDir.delete(key);
        return [] as CommandInfo[];
      });
    inflightByDir.set(key, inflight);
  }
  return inflight;
}

export function cachedCommands(directory: string | null): CommandInfo[] | null {
  return cacheByDir.get(dirKey(directory)) ?? null;
}
