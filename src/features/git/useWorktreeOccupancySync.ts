import { useEffect } from "react";

import { useTabsStore } from "@/components/tabs/tabsStore";
import { useWorktreesStore } from "./worktrees.store";

/**
 * Keep `worktreesStore.occupancyByPath` in lockstep with `tabsStore.byProject`:
 * whenever a tab is opened or closed, we recompute which worktree directories
 * are currently hosting a live terminal/cli. The UI uses this for the "in use"
 * pip on a worktree row + to gate destructive actions.
 *
 * Recomputation is cheap (linear over tabs once per change) so we don't bother
 * memoizing further — Zustand selectors already debounce-to-equality.
 */
export function useWorktreeOccupancySync() {
  useEffect(() => {
    const recompute = () => {
      const buckets = useTabsStore.getState().byProject;
      const next: Record<string, string[]> = {};
      for (const bucket of Object.values(buckets)) {
        for (const tab of bucket.tabs) {
          if (tab.kind !== "terminal" && tab.kind !== "cli") continue;
          (next[tab.cwd] ??= []).push(tab.id);
        }
      }
      useWorktreesStore.getState().setOccupancy(next);
    };
    recompute();
    const unsub = useTabsStore.subscribe(recompute);
    return () => unsub();
  }, []);
}
