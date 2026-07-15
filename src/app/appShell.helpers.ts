import { basename } from "@/lib/path";

/** Re-export Close request type from Tab lifecycle (canonical home). */
export type { PendingClose } from "@/features/tabs/closePolicy";
export { processSummary } from "@/features/tabs/closePolicy";

/** Heuristic: dropped paths with a file extension are previewed; extensionless
 * paths route to "add project". Stat can't help here because a dropped path
 * lives outside any root, so the roots-checked stat would reject it. */
export function looksLikeFile(path: string): boolean {
  return /\.[^./\\]{1,16}$/.test(basename(path));
}

export const EMPTY_BUCKET = { tabs: [], activeTabId: null } as {
  tabs: [];
  activeTabId: null;
};

export const RAIL_WIDTH_PX = 48;
