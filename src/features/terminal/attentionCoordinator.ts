import type { TabsBucket } from "@/components/tabs/tabsStore";
import { WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { isProcessTab } from "@/features/tabs";
import { attentionOrder, type AgentStatusEntry } from "./agent-status.store";

export interface AttentionTarget {
  projectKey: string;
  tabId: string;
}

export function nextAttentionTarget(
  byTab: Record<string, AgentStatusEntry>,
  buckets: Record<string, TabsBucket>,
  activeProjectId: string | null,
): AttentionTarget | null {
  const locations = new Map<string, string>();
  for (const [projectKey, bucket] of Object.entries(buckets)) {
    for (const tab of bucket.tabs.filter(isProcessTab)) locations.set(tab.id, projectKey);
  }
  const ordered = attentionOrder(byTab).filter((id) => locations.has(id));
  if (ordered.length === 0) return null;
  const currentProject = activeProjectId ?? WORKSPACE_NULL;
  const current = buckets[currentProject]?.activeTabId ?? null;
  const index = current ? ordered.indexOf(current) : -1;
  const tabId = ordered[(index + 1) % ordered.length];
  const projectKey = locations.get(tabId);
  return projectKey ? { projectKey, tabId } : null;
}
