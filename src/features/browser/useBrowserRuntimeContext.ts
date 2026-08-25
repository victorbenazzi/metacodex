import { useMemo } from "react";

import { serversFromSessions } from "@/features/browser/devServers";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSidePanelStore } from "@/features/side-panel/sidePanel.store";
import { useTabMetadataStore } from "@/features/terminal/tabMetadata.store";
import { useTerminalStore } from "@/features/terminal/terminal.store";

export function useBrowserRuntimeContext() {
  const sessions = useTerminalStore((state) => state.sessions);
  const metadata = useTabMetadataStore((state) => state.bySessionId);
  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const browserTabOpen = useSidePanelStore((state) => state.openTabs.includes("browser"));
  const servers = useMemo(
    () => serversFromSessions(Object.values(sessions), metadata, projects, activeProjectId),
    [sessions, metadata, projects, activeProjectId],
  );
  return { browserTabOpen, servers };
}
