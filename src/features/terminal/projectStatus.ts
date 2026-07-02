import { useMemo } from "react";

import { useTabsStore } from "@/components/tabs/tabsStore";
import {
  useAgentStatusStore,
  type AgentStatus,
  type AgentStatusEntry,
} from "./agent-status.store";
import type { Tab } from "@/components/tabs/types";

export interface ProjectAgentStatus {
  /** Worst per-tab status across the project, or null when everything is idle. */
  status: AgentStatus | null;
  /** Max urgency among needs-attention tabs; tints the dot warn vs danger. */
  urgency?: number;
  /** Live process tabs (terminals + agent CLIs) in the project. */
  sessionCount: number;
}

const STATUS_RANK: Record<AgentStatus, number> = {
  "needs-attention": 3,
  working: 2,
  done: 1,
  idle: 0,
};

/**
 * Aggregate a project's per-tab agent statuses, worst-first: needs-attention
 * beats working beats done. Pure so it stays trivially testable and reusable.
 */
export function aggregateProjectStatus(
  tabs: Tab[],
  byTab: Record<string, AgentStatusEntry>,
): ProjectAgentStatus {
  let status: AgentStatus | null = null;
  let urgency: number | undefined;
  let sessionCount = 0;
  for (const tab of tabs) {
    if (tab.kind !== "terminal" && tab.kind !== "cli") continue;
    sessionCount += 1;
    const entry = byTab[tab.id];
    if (!entry || entry.status === "idle") continue;
    if (entry.status === "needs-attention") {
      urgency = Math.max(urgency ?? 0, entry.urgency ?? 0);
    }
    if (status === null || STATUS_RANK[entry.status] > STATUS_RANK[status]) {
      status = entry.status;
    }
  }
  return { status, urgency, sessionCount };
}

/**
 * Project-level rollup of the per-tab agent status. Powers the status dot on
 * the project row (expanded sidebar) and the rail tile badge, so "which
 * project is running / waiting on me" is visible without opening the project.
 */
export function useProjectAgentStatus(projectId: string): ProjectAgentStatus {
  const bucket = useTabsStore((s) => s.byProject[projectId]);
  const byTab = useAgentStatusStore((s) => s.byTab);
  return useMemo(() => aggregateProjectStatus(bucket?.tabs ?? [], byTab), [bucket, byTab]);
}
