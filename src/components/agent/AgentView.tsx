import { useEffect, useRef } from "react";

import { useAgentChatStore } from "@/features/agent/chat.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { useAgentRuntimeStore } from "@/features/agent/runtime.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { AgentSidebar } from "@/components/agent/AgentSidebar";
import { AgentHero } from "@/components/agent/AgentHero";
import { AgentComposer } from "@/components/agent/AgentComposer";
import { ChatThread } from "@/components/agent/chat/ChatThread";
import { SkillsPanel } from "@/components/agent/panels/SkillsPanel";
import { ScheduledTasksPanel } from "@/components/agent/panels/ScheduledTasksPanel";
import { WebBridgePanel } from "@/components/agent/panels/ComingSoonPanels";
import { cn } from "@/lib/cn";

interface AgentViewProps {
  className?: string;
}

/**
 * Top-level Agent View surface. Rendered as an opaque overlay below the
 * titlebar (see AppShell) so the Code View — and its live terminals — stay
 * mounted underneath while in Agent mode. The left rail drives which surface
 * the main area shows; `chat` is the hero (empty) or the thread + composer.
 */
export function AgentView({ className }: AgentViewProps) {
  const connect = useAgentChatStore((s) => s.connect);
  const hasThread = useAgentChatStore((s) => s.thread.length > 0);
  const setDirectory = useAgentChatStore((s) => s.setDirectory);
  const section = useAgentNavStore((s) => s.section);
  const loadModels = useAgentRuntimeStore((s) => s.loadModels);
  const activeProject = useProjectsStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );

  useEffect(() => {
    void connect();
    void loadModels();
  }, [connect, loadModels]);

  // Default the agent to the active metacodex project ONCE, the first time it
  // resolves. After that the project (including "work without a folder") is the
  // user's to pick — a one-shot ref so choosing no-folder isn't snapped back.
  const didInitDirectory = useRef(false);
  useEffect(() => {
    if (didInitDirectory.current || !activeProject) return;
    didInitDirectory.current = true;
    void setDirectory(activeProject.path);
  }, [activeProject, setDirectory]);

  return (
    <div className={cn("flex bg-canvas text-ink", className)}>
      <AgentSidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {section === "skills" ? (
          <SkillsPanel />
        ) : section === "scheduled" ? (
          <ScheduledTasksPanel />
        ) : section === "webbridge" ? (
          <WebBridgePanel />
        ) : hasThread ? (
          <>
            <ChatThread className="min-h-0 flex-1" />
            <div className="border-t border-hairline-soft bg-canvas px-[20px] py-[14px]">
              <div className="mx-auto max-w-[760px]">
                <AgentComposer compact />
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-[24px]">
            <AgentHero />
          </div>
        )}
      </main>
    </div>
  );
}
