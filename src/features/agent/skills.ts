import { CMD, invoke } from "@/lib/ipc";

/**
 * Shared skills catalog for the composer surfaces (the "+" menu and the "/"
 * autocomplete). One module-level cache: skills live on disk and only change
 * when the user installs one, so a session-long cache is fine, the Skills
 * panel does its own fresh fetch.
 */

export interface SkillInfo {
  name: string;
  description: string;
  /** Which skills dir it came from: metacodex | opencode | claude | agents. */
  source: string;
  path: string;
}

let cache: SkillInfo[] | null = null;
let inflight: Promise<SkillInfo[]> | null = null;

export function loadSkills(): Promise<SkillInfo[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = invoke<SkillInfo[]>(CMD.agentListSkills)
      .then((rows) => {
        cache = rows;
        return rows;
      })
      .catch(() => {
        inflight = null;
        return [] as SkillInfo[];
      });
  }
  return inflight;
}

export function cachedSkills(): SkillInfo[] | null {
  return cache;
}
