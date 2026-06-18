import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { AlarmClock, Blocks, Bot, CirclePlus, Settings } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { useSettingsStore } from "@/features/settings/settings.store";
import { ProjectSection } from "@/components/agent/ProjectSection";
import { SidebarTasks } from "@/components/agent/SidebarTasks";
import { cn } from "@/lib/cn";

/**
 * Left rail of the Agent View. A single Work surface (the standalone Chat pane
 * was removed: chatting is just sending a message inside Work). Drives which
 * surface the main area shows via the nav store.
 */
export function AgentSidebar() {
  const { t } = useTranslation();

  return (
    <aside className="atmosphere-soft flex h-full w-[264px] shrink-0 flex-col border-r border-hairline">
      <div className="min-h-0 flex-1 overflow-y-auto px-[8px] pb-[12px] pt-[12px]">
        <WorkPane />
      </div>

      <div className="border-t border-hairline-soft px-[8px] py-[6px]">
        <button
          type="button"
          onClick={() => useSettingsStore.getState().openTab("agent")}
          className="flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[7px] text-left text-ui text-body transition-colors hover:bg-surface-strong/40 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
        >
          <Icon icon={Settings} size={13} className="text-muted" />
          {t("agent.sidebar.settings")}
        </button>
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
        icon={Bot}
        label={t("agent.sidebar.agents")}
        active={section === "agents"}
        onClick={() => useAgentNavStore.getState().openAgents()}
      />
      <SidebarItem
        icon={AlarmClock}
        label={t("agent.sidebar.scheduledTasks")}
        active={section === "scheduled"}
        onClick={() => setSection("scheduled")}
      />
      <SidebarItem
        icon={Blocks}
        label={t("agent.sidebar.customize")}
        active={section === "customize"}
        onClick={() => setSection("customize")}
      />

      <ProjectSection />

      <SectionLabel>{t("agent.sidebar.tasks")}</SectionLabel>
      <SidebarTasks />
    </nav>
  );
}

interface SidebarItemProps {
  icon: LucideIcon;
  label: string;
  kbd?: string;
  badge?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

function SidebarItem({ icon, label, kbd, badge, active, disabled, onClick }: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group flex w-full items-center gap-[10px] rounded-md px-[10px] py-[7px] text-ui transition-colors duration-fast",
        active ? "bg-surface-2 text-ink" : "text-body hover:bg-surface-1",
        disabled && "cursor-default text-muted-soft hover:bg-transparent",
      )}
    >
      <Icon
        icon={icon}
        size={16}
        strokeWidth={1.75}
        className={active ? "text-ink" : disabled ? "text-muted-soft" : "text-muted"}
      />
      <span className="flex-1 truncate text-left">{label}</span>
      {badge ? (
        <span className="rounded-pill bg-surface-1 px-[7px] py-[1px] text-[10px] uppercase tracking-label text-muted-soft">
          {badge}
        </span>
      ) : null}
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
    <p className="px-[10px] pb-[4px] pt-[16px] text-label font-medium uppercase tracking-label text-muted-soft">
      {children}
    </p>
  );
}
