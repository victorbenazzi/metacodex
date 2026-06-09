import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import {
  AlarmClock,
  BookOpen,
  CirclePlus,
  Globe,
  MessageSquare,
  Monitor,
  SquarePen,
} from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { ProjectSection } from "@/components/agent/ProjectSection";
import { cn } from "@/lib/cn";

type Pane = "work" | "chat";

/**
 * Left rail of the Agent View. Mirrors the Kimi structure (Work | Chat) but is
 * reskinned to metacodex tokens. Drives which surface the main area shows via
 * the nav store; the Chat pane is wired to the chat store (new chat + history).
 */
export function AgentSidebar() {
  const { t } = useTranslation();
  const [pane, setPane] = useState<Pane>("work");
  const setSection = useAgentNavStore((s) => s.setSection);

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-hairline bg-canvas-soft">
      <div className="px-[12px] pb-[8px] pt-[12px]">
        <Segmented
          ariaLabel={t("agent.sidebar.paneLabel")}
          value={pane}
          onChange={(p) => {
            setPane(p);
            if (p === "chat") setSection("chat");
          }}
          className="w-full [&>button]:flex-1"
          options={[
            { value: "work", label: t("agent.sidebar.work"), icon: Monitor },
            { value: "chat", label: t("agent.sidebar.chat"), icon: MessageSquare },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[8px] pb-[12px]">
        {pane === "work" ? <WorkPane /> : <ChatPane />}
      </div>
    </aside>
  );
}

function WorkPane() {
  const { t } = useTranslation();
  const section = useAgentNavStore((s) => s.section);
  const setSection = useAgentNavStore((s) => s.setSection);
  const newChat = useAgentChatStore((s) => s.newChat);

  return (
    <nav className="flex flex-col gap-[1px]">
      <SidebarItem
        icon={CirclePlus}
        label={t("agent.sidebar.newTask")}
        kbd="⌘K"
        active={section === "chat"}
        onClick={() => {
          setSection("chat");
          newChat();
        }}
      />
      <SidebarItem
        icon={BookOpen}
        label={t("agent.sidebar.skills")}
        active={section === "skills"}
        onClick={() => setSection("skills")}
      />
      <SidebarItem
        icon={AlarmClock}
        label={t("agent.sidebar.scheduledTasks")}
        active={section === "scheduled"}
        onClick={() => setSection("scheduled")}
      />
      <SidebarItem
        icon={Globe}
        label={t("agent.sidebar.webBridge")}
        active={section === "webbridge"}
        onClick={() => setSection("webbridge")}
      />

      <ProjectSection />

      <SectionLabel>{t("agent.sidebar.tasks")}</SectionLabel>
      <EmptyHint>{t("agent.sidebar.tasksEmpty")}</EmptyHint>
    </nav>
  );
}

function ChatPane() {
  const { t } = useTranslation();
  const sessions = useAgentChatStore((s) => s.sessions);
  const sessionId = useAgentChatStore((s) => s.sessionId);
  const newChat = useAgentChatStore((s) => s.newChat);
  const selectSession = useAgentChatStore((s) => s.selectSession);
  const setSection = useAgentNavStore((s) => s.setSection);

  return (
    <nav className="flex flex-col gap-[1px]">
      <SidebarItem
        icon={SquarePen}
        label={t("agent.sidebar.newChat")}
        onClick={() => {
          setSection("chat");
          newChat();
        }}
      />

      <SectionLabel>{t("agent.sidebar.chats")}</SectionLabel>
      {sessions.length === 0 ? (
        <EmptyHint>{t("agent.sidebar.chatsEmpty")}</EmptyHint>
      ) : (
        sessions.map((s) => (
          <SidebarItem
            key={s.id}
            icon={MessageSquare}
            label={s.title || t("agent.sidebar.untitledChat")}
            active={s.id === sessionId}
            onClick={() => {
              setSection("chat");
              void selectSession(s.id);
            }}
          />
        ))
      )}
    </nav>
  );
}

interface SidebarItemProps {
  icon: LucideIcon;
  label: string;
  kbd?: string;
  active?: boolean;
  onClick?: () => void;
}

function SidebarItem({ icon, label, kbd, active, onClick }: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-[10px] rounded-md px-[10px] py-[7px] text-[13px] transition-colors duration-150",
        active ? "bg-surface-2 text-ink" : "text-body hover:bg-surface-1",
      )}
    >
      <Icon
        icon={icon}
        size={16}
        strokeWidth={1.75}
        className={active ? "text-ink" : "text-muted"}
      />
      <span className="flex-1 truncate text-left">{label}</span>
      {kbd ? (
        <kbd className="rounded-sm border border-hairline-soft bg-surface-1 px-[5px] py-[1px] font-mono text-[10px] text-muted-soft">
          {kbd}
        </kbd>
      ) : null}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-[10px] pb-[4px] pt-[16px] text-[11px] font-medium uppercase tracking-[0.06em] text-muted-soft">
      {children}
    </p>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="px-[10px] py-[4px] text-[12px] leading-[1.5] text-muted">{children}</p>;
}
