import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useAgentChatStore } from "@/features/agent/chat.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { useAgentRuntimeStore } from "@/features/agent/runtime.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { AgentSidebar } from "@/components/agent/AgentSidebar";
import { AgentHero } from "@/components/agent/AgentHero";
import { AgentOnboarding, OPENCODE_CLI } from "@/components/agent/AgentOnboarding";
import { cliDetectionFor, useCliDetections } from "@/features/terminal/cli-detection";
import { AgentComposer } from "@/components/agent/AgentComposer";
import { ChatThread } from "@/components/agent/chat/ChatThread";
import { ContextMeter } from "@/components/agent/chat/ContextMeter";
import { ScheduledTasksPanel } from "@/components/agent/panels/ScheduledTasksPanel";
import { CustomizePanel } from "@/components/agent/panels/CustomizePanel";
import { cn } from "@/lib/cn";

interface AgentViewProps {
  className?: string;
}

function ReconnectingBanner() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-[8px] border-b border-hairline-soft bg-surface-1 px-[12px] py-[5px] text-[12px] text-muted">
      <span className="inline-block h-[6px] w-[6px] animate-pulse rounded-full bg-warn" />
      {t("agent.chat.reconnecting")}
    </div>
  );
}

/**
 * Top-level Agent View surface. Rendered as an opaque overlay below the
 * titlebar (see AppShell) so the Code View, and its live terminals, stay
 * mounted underneath while in Agent mode. The left rail drives which surface
 * the main area shows; `chat` is the hero (empty) or the thread + composer.
 */
// One-shot per APP SESSION, not per mount: AgentView unmounts on every
// Agent -> Code toggle, so a component-local ref would re-snap the directory
// back to the active project (wiping the open thread) on every re-entry.
let didInitDirectory = false;

export function AgentView({ className }: AgentViewProps) {
  const connect = useAgentChatStore((s) => s.connect);
  const hasThread = useAgentChatStore(
    (s) => s.thread.length > 0 || s.threadLoading || s.sessionId !== null,
  );
  const connected = useAgentChatStore((s) => s.connected);
  const connecting = useAgentChatStore((s) => s.connecting);
  const baseUrl = useAgentChatStore((s) => s.baseUrl);
  // Connection-level failures only: a stale SEND error must never repaint the
  // whole chat as "runtime down" (the send error renders in the composer).
  const connectionError = useAgentChatStore((s) => s.connectionError);
  const setDirectory = useAgentChatStore((s) => s.setDirectory);
  const section = useAgentNavStore((s) => s.section);
  const loadModels = useAgentRuntimeStore((s) => s.loadModels);
  const activeProject = useProjectsStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );

  // Missing-binary guidance shows as soon as the PATH probe resolves (~1s),
  // not after the sidecar spawn's 25s timeout; a real spawn failure (binary
  // present) still falls back to the error path below.
  const detections = useCliDetections();
  const opencodeMissing = cliDetectionFor(OPENCODE_CLI, detections).status === "missing";
  const runtimeBlocked = !connected && (opencodeMissing || (!connecting && !!connectionError));

  useEffect(() => {
    void connect();
    void loadModels();
  }, [connect, loadModels]);

  // Default the agent to the active metacodex project ONCE, the first time it
  // resolves. After that the project (including "work without a folder") is the
  // user's to pick; the module-level flag survives view toggles.
  useEffect(() => {
    if (didInitDirectory || !activeProject) return;
    didInitDirectory = true;
    void setDirectory(activeProject.path);
  }, [activeProject, setDirectory]);

  return (
    <div className={cn("flex bg-canvas text-ink", className)}>
      <AgentSidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Stream dropped after a successful connect: the reconnect loop is
            already re-resolving the sidecar; tell the user instead of leaving
            a normal-looking chat with a silently dead stream. */}
        {baseUrl && !connected && !runtimeBlocked ? (
          <ReconnectingBanner />
        ) : null}
        {section === "scheduled" ? (
          <ScheduledTasksPanel />
        ) : section === "customize" ? (
          <CustomizePanel />
        ) : runtimeBlocked ? (
          // The runtime can't come up (opencode missing from PATH, or the
          // sidecar failed). Only the Agent view depends on opencode, the
          // Code view stays fully usable, so the guidance lives only here.
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-[24px]">
            <AgentOnboarding />
          </div>
        ) : hasThread ? (
          <>
            <ChatThread className="min-h-0 flex-1" />
            <div className="border-t border-hairline-soft bg-canvas px-[20px] py-[14px]">
              <div className="mx-auto max-w-[760px]">
                <ContextMeter />
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
