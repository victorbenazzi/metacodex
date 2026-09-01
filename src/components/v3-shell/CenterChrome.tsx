import { UpdatePill } from "@/components/updates/UpdatePill";
import { renderTabIcon } from "@/components/tabs/tabChrome";
import { TabStatusDot } from "@/components/tabs/TabStatusDot";
import { resolveTabTitle } from "@/components/tabs/types";
import { useTabsStore, WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { useProjectsStore } from "@/features/projects/project.store";
import { useAgentStatusStore } from "@/features/terminal/agent-status.store";
import { useActiveProcessTab } from "@/features/tabs/useActiveProcessTab";
import { useCodeSidebarStore } from "@/features/ui/codeSidebar.store";
import { useSidePanelStore } from "@/features/side-panel/sidePanel.store";
import { cn } from "@/lib/cn";
import { hasCustomWindowControls, isMac } from "@/lib/platform";

/**
 * Center column chrome. When an agent/terminal is running, this is its
 * identity strip (brand icon + the title the process set). No tab strip:
 * agents switch from the left sidebar.
 */
export function CenterChrome() {
  const panelOpen = useSidePanelStore((s) => s.view !== "closed");
  const sidebarOpen = !useCodeSidebarStore((s) => s.collapsed);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const projectKey = activeProjectId ?? WORKSPACE_NULL;
  const bucket = useTabsStore((s) => s.byProject[projectKey]);
  const agent = useActiveProcessTab(bucket?.tabs ?? [], bucket?.activeTabId ?? null);
  const agentWorking = useAgentStatusStore((s) =>
    agent ? s.byTab[agent.id]?.status === "working" : false,
  );

  return (
    <div
      data-tauri-drag-region
      className={cn(
        "flex h-[var(--title-bar-h)] shrink-0 items-center gap-8px",
        sidebarOpen ? "pl-12px" : isMac ? "pl-[126px]" : "pl-44px",
        panelOpen ? "pr-12px" : hasCustomWindowControls ? "pr-[176px]" : "pr-42px",
      )}
    >
      {agent ? (
        <div className="flex min-w-0 flex-1 items-center gap-8px">
          <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center">
            {renderTabIcon(agent, true)}
          </span>
          <span
            className={cn(
              "min-w-0 truncate text-ui font-medium",
              agentWorking ? "loading-shimmer" : "text-ink",
            )}
          >
            {resolveTabTitle(agent)}
          </span>
          <TabStatusDot tabId={agent.id} />
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <div className="ml-auto flex items-center gap-8px">
        <UpdatePill />
      </div>
    </div>
  );
}
