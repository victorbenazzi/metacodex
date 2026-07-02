import type { Tab } from "@/components/tabs/types";
import { basename } from "@/lib/path";

export type PendingClose = {
  ids: string[];
  mode: "single" | "others" | "all";
  terminals: number;
  agents: number;
  /** When mode === "single", the affected tab (for personalized copy). */
  singleTab?: Tab;
};

/** Heuristic: dropped paths with a file extension are previewed; extensionless
 * paths route to "add project". Stat can't help here because a dropped path
 * lives outside any root, so the roots-checked stat would reject it. */
export function looksLikeFile(path: string): boolean {
  return /\.[^./\\]{1,16}$/.test(basename(path));
}

export function processSummary(tabs: Tab[]): { terminals: number; agents: number } {
  let terminals = 0;
  let agents = 0;
  for (const t of tabs) {
    if (t.kind === "terminal") terminals += 1;
    else if (t.kind === "cli") agents += 1;
  }
  return { terminals, agents };
}

export const EMPTY_BUCKET = { tabs: [], activeTabId: null } as {
  tabs: [];
  activeTabId: null;
};

export const RAIL_WIDTH_PX = 48;
export const PROJECTS_PANEL_WIDTH_PX = 264;
