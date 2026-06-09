import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { DropdownContent, DropdownRoot, DropdownTrigger } from "@/components/ui/DropdownMenu";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { tileIconColor } from "@/features/projects/color";
import { useThemeStore } from "@/features/theme/theme.store";
import { cn } from "@/lib/cn";

import { CreateProjectDialog } from "./composer/CreateProjectDialog";
import { ProjectActionItems } from "./composer/ProjectActions";

/**
 * Sidebar PROJECT section: a collapsible header (chevron) with a `+` menu to
 * start a project, over the full list of registered projects. Clicking a project
 * scopes the agent to it (shared `setDirectory`), so the sidebar and the
 * composer picker stay in sync.
 */
export function ProjectSection() {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const directory = useAgentChatStore((s) => s.directory);
  const setDirectory = useAgentChatStore((s) => s.setDirectory);
  const theme = useThemeStore((s) => s.effective);

  const [collapsed, setCollapsed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between gap-[4px] pl-[10px] pr-[6px] pb-[4px] pt-[16px]">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex min-w-0 flex-1 items-center gap-[4px] text-[11px] font-medium uppercase tracking-[0.06em] text-muted-soft outline-none transition-colors hover:text-muted"
        >
          <Icon
            icon={ChevronDown}
            size={12}
            strokeWidth={2.25}
            className={cn("shrink-0 transition-transform duration-150", collapsed && "-rotate-90")}
          />
          <span className="truncate">{t("agent.sidebar.project")}</span>
        </button>
        <DropdownRoot>
          <DropdownTrigger asChild>
            <button
              type="button"
              aria-label={t("agent.project.startScratch")}
              className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-sm text-muted-soft outline-none transition-colors hover:bg-surface-1 hover:text-muted data-[state=open]:bg-surface-1 data-[state=open]:text-muted"
            >
              <Icon icon={Plus} size={14} strokeWidth={2} />
            </button>
          </DropdownTrigger>
          <DropdownContent align="end" className="min-w-[220px]">
            <ProjectActionItems onStartScratch={() => setCreateOpen(true)} />
          </DropdownContent>
        </DropdownRoot>
      </div>

      {collapsed ? null : projects.length === 0 ? (
        <p className="px-[10px] py-[4px] text-[12px] leading-[1.5] text-muted">
          {t("agent.sidebar.projectEmpty")}
        </p>
      ) : (
        <div className="flex flex-col gap-[1px]">
          {projects.map((p) => {
            const active = p.path === directory;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => void setDirectory(p.path)}
                className={cn(
                  "group flex w-full items-center gap-[8px] rounded-md px-[10px] py-[6px] text-[13px] transition-colors duration-150",
                  active ? "bg-surface-2 text-ink" : "text-body hover:bg-surface-1",
                )}
              >
                <span
                  className="h-[8px] w-[8px] shrink-0 rounded-full"
                  style={{ backgroundColor: tileIconColor(p.color, theme) }}
                />
                <span className="flex-1 truncate text-left">{p.name}</span>
              </button>
            );
          })}
        </div>
      )}

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(p) => void setDirectory(p.path)}
      />
    </>
  );
}
