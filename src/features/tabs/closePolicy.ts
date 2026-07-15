import type { Tab } from "@/components/tabs/types";
import { isProcessTab } from "./factories";

export type PendingClose = {
  ids: string[];
  mode: "single" | "others" | "all";
  terminals: number;
  agents: number;
  /** When mode === "single", the affected tab (for personalized copy). */
  singleTab?: Tab;
  /** Bucket the close targets (needed when dialog is shared across surfaces). */
  projectKey: string;
};

export function processSummary(tabs: Tab[]): { terminals: number; agents: number } {
  let terminals = 0;
  let agents = 0;
  for (const t of tabs) {
    if (t.kind === "terminal") terminals += 1;
    else if (t.kind === "cli") agents += 1;
  }
  return { terminals, agents };
}

export type ClosePlan =
  | { action: "close"; ids: string[]; projectKey: string }
  | { action: "confirm"; pending: PendingClose };

/**
 * Decide whether closing `targets` needs user confirm (Process tabs present).
 * Pure: no store mutation, no kill.
 */
export function planClose(
  projectKey: string,
  mode: PendingClose["mode"],
  targets: Tab[],
  singleTab?: Tab,
): ClosePlan | null {
  const ids = targets.map((tab) => tab.id);
  if (ids.length === 0) return null;
  const { terminals, agents } = processSummary(targets);
  if (terminals === 0 && agents === 0) {
    return { action: "close", ids, projectKey };
  }
  return {
    action: "confirm",
    pending: { ids, mode, terminals, agents, singleTab, projectKey },
  };
}

/** Plan close for a single tab id in a bucket. */
export function planCloseTab(
  projectKey: string,
  tabs: Tab[],
  tabId: string,
): ClosePlan | null {
  const target = tabs.find((tab) => tab.id === tabId);
  if (!target) return null;
  if (isProcessTab(target)) {
    return planClose(projectKey, "single", [target], target);
  }
  return { action: "close", ids: [tabId], projectKey };
}
