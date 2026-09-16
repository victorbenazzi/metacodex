import { useEffect, useMemo, useState } from "react";
import { useProjectsStore } from "@/features/projects/project.store";
import { useTabsStore } from "@/components/tabs/tabsStore";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { useUsageStore } from "./usage.store";

export function useUsageView(active: boolean) {
  const snapshot = useUsageStore(s => s.snapshot);
  const refreshing = useUsageStore(s => s.refreshing);
  const error = useUsageStore(s => s.error);
  const projects = useProjectsStore(s => s.projects);
  const buckets = useTabsStore(s => s.byProject);
  const terminals = useTerminalStore(s => s.sessions);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      if (active) void useUsageStore.getState().refresh();
    };
    tick();
    // Age the sidebar indicator even when the panel is closed, without polling
    // providers in the background.
    const interval = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", tick); };
  }, [active]);
  const liveSessions = useMemo(() => {
    const running = new Set(Object.values(terminals)
      .filter(session => session.status === "running").map(session => session.tabId));
    return Object.values(buckets).flatMap(bucket => bucket.tabs)
      .filter(tab => tab.kind === "cli")
      .filter(tab => running.has(tab.id));
  }, [buckets, terminals]);
  return { snapshot, refreshing, error, projects, liveSessions, now };
}
