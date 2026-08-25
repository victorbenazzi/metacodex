import { useMemo, useState } from "react";
import { ChevronDown, Folder, Plus, TerminalSquare, X } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import { ProjectContextMenu } from "@/components/project-rail/ProjectContextMenu";
import { TabStatusDot } from "@/components/tabs/TabStatusDot";
import { resolveTabTitle } from "@/components/tabs/types";
import { useTabsStore } from "@/components/tabs/tabsStore";
import { requestCloseTab, focusProcessTab, openResume } from "@/features/tabs";
import { useProjectsStore } from "@/features/projects/project.store";
import { useResumeStore } from "@/features/resume/resume.store";
import { isLiveResumeSession } from "@/features/resume/resumeLaunch";
import { resumeFlagFor } from "@/features/resume/sessionDetectors";
import type { ResumeEntry } from "@/features/resume/resume.service";
import { cliById } from "@/features/terminal/cli-registry";
import { useCodeSidebarStore } from "@/features/ui/codeSidebar.store";
import { useV3ShellStore } from "@/features/v3-shell/v3Shell.store";
import type { Project } from "@/features/projects/project.types";
import { cn } from "@/lib/cn";
import { basename } from "@/lib/path";
import { agoShort } from "@/lib/time";

const THREAD_CAP = 6;

interface RepoRowProps {
  project: Project;
  active: boolean;
  onRequestRename: (project: Project) => void;
  onRequestRemove: (project: Project) => void;
}

/**
 * Cursor-style repository row. Closed by default: empty projects stay folded
 * until the chevron is used. Hover swaps the folder for a chevron, paints the
 * pill, and reveals the + that opens New Agent on this project.
 */
export function RepoRow({
  project,
  active,
  onRequestRename,
  onRequestRemove,
}: RepoRowProps) {
  const { t } = useTranslation();
  const setActive = useProjectsStore((s) => s.setActive);
  const expandedProjects = useCodeSidebarStore((s) => s.expandedProjects);
  const setProjectExpanded = useCodeSidebarStore((s) => s.setProjectExpanded);
  const setNewAgentOpen = useV3ShellStore((s) => s.setNewAgentOpen);
  const [showAll, setShowAll] = useState(false);

  const expanded = expandedProjects[project.id] === true;

  const resumeEntries = useResumeStore((s) => s.entries);
  const bucket = useTabsStore((s) => s.byProject[project.id]);

  const live = useMemo(
    () => (bucket?.tabs ?? []).filter((tab) => tab.kind === "cli" || tab.kind === "terminal"),
    [bucket],
  );
  const history = useMemo(
    () =>
      resumeEntries
        .filter((e) => e.projectId === project.id && resumeFlagFor(e.cliId) !== null)
        .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)),
    [resumeEntries, project.id],
  );

  const historyOnly = history.filter((e) => !live.some((tab) => isLiveResumeSession(tab, e)));
  const totalThreads = live.length + historyOnly.length;
  const visibleLive = showAll ? live : live.slice(0, THREAD_CAP);
  const remaining = THREAD_CAP - visibleLive.length;
  const visibleHistory = showAll
    ? historyOnly
    : remaining > 0
      ? historyOnly.slice(0, remaining)
      : [];
  const hiddenCount = Math.max(0, totalThreads - visibleLive.length - visibleHistory.length);

  const focusTab = (tabId: string) => {
    void setActive(project.id);
    focusProcessTab(project.id, tabId);
  };
  const resume = (entry: ResumeEntry) => {
    void setActive(project.id);
    openResume(entry);
  };

  const empty = totalThreads === 0;

  return (
    <div>
      <ProjectContextMenu
        project={project}
        onRequestRename={() => onRequestRename(project)}
        onRequestRemove={() => onRequestRemove(project)}
      >
        <div
          className={cn(
            "group/proj flex w-full items-center gap-8px rounded-sm px-8px py-5px",
            "transition-colors duration-fast",
            "text-ink hover:bg-surface-strong/40",
          )}
        >
          <button
            type="button"
            data-no-drag
            aria-expanded={expanded}
            aria-label={expanded ? t("codeSidebar.collapseProject") : t("codeSidebar.expandProject")}
            onClick={() => setProjectExpanded(project.id, !expanded)}
            className="relative flex h-[16px] w-[16px] shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink outline-none transition-colors duration-fast hover:bg-canvas/40 focus-visible:ring-1 focus-visible:ring-hairline-strong"
          >
            <Icon
              icon={Folder}
              size={14}
              className={cn(
                "transition-opacity duration-fast",
                expanded ? "opacity-0" : "opacity-100 group-hover/proj:opacity-0",
              )}
            />
            <Icon
              icon={ChevronDown}
              size={14}
              className={cn(
                "absolute transition-[opacity,transform] duration-fast",
                expanded
                  ? "opacity-100"
                  : "opacity-0 -rotate-90 group-hover/proj:opacity-100",
              )}
            />
          </button>
          <button
            type="button"
            title={project.path}
            onClick={() => void setActive(project.id)}
            className={cn(
              "min-w-0 flex-1 truncate text-left text-ui leading-none outline-none",
              "focus-visible:ring-1 focus-visible:ring-hairline-strong",
            )}
          >
            {project.name}
          </button>
          <Tooltip content={t("v3.newAgent.title")} side="bottom">
            <IconButton
              size="sm"
              data-no-drag
              aria-label={t("v3.newAgent.title")}
              onClick={(e) => {
                e.stopPropagation();
                void setActive(project.id);
                setNewAgentOpen(true);
              }}
              className={cn(
                "text-muted transition-opacity duration-fast",
                expanded
                  ? "opacity-100"
                  : "opacity-0 group-hover/proj:opacity-100 focus-visible:opacity-100",
              )}
            >
              <Icon icon={Plus} size={12} />
            </IconButton>
          </Tooltip>
        </div>
      </ProjectContextMenu>

      {expanded ? (
        empty ? (
          <p className="px-8px py-[5px] pl-[42px] text-ui text-muted">
            {t("v3.repos.noAgents")}
          </p>
        ) : (
          <div data-no-drag className="flex flex-col gap-[2px] pb-4px">
            {visibleLive.map((tab) => (
              <ThreadRow
                key={tab.id}
                label={
                  tab.kind === "terminal"
                    ? basename(tab.cwd) || resolveTabTitle(tab)
                    : resolveTabTitle(tab)
                }
                pathHint={tab.kind === "terminal" ? tab.cwd : undefined}
                tabId={tab.id}
                cliId={tab.kind === "cli" ? tab.cliId : undefined}
                active={active && bucket?.activeTabId === tab.id}
                onFocus={() => focusTab(tab.id)}
                onClose={() => requestCloseTab(project.id, tab.id)}
                closeLabel={t(tab.kind === "cli" ? "codeSidebar.endAgent" : "codeSidebar.endTerminal")}
              />
            ))}
            {visibleHistory.map((entry) => {
              const cli = cliById(entry.cliId);
              return (
                <ThreadRow
                  key={entry.id}
                  label={entry.branch || basename(entry.cwd) || cli?.label || entry.cliId}
                  cliId={entry.cliId}
                  age={agoShort(entry.lastSeenAt)}
                  onFocus={() => resume(entry)}
                />
              );
            })}
            {hiddenCount > 0 && !showAll ? (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-8px rounded-md py-[5px] pl-[30px] pr-8px",
                  "text-left text-ui text-muted transition-colors duration-fast",
                  "hover:bg-surface-strong/40 hover:text-ink",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
                )}
              >
                <span className="h-[14px] w-[14px] shrink-0" aria-hidden />
                {t("common.more")}
              </button>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}

function ThreadRow({
  label,
  pathHint,
  tabId,
  cliId,
  active = false,
  age,
  onFocus,
  onClose,
  closeLabel,
}: {
  label: string;
  pathHint?: string;
  tabId?: string;
  cliId?: string;
  active?: boolean;
  age?: string;
  onFocus: () => void;
  onClose?: () => void;
  closeLabel?: string;
}) {
  const Brand = cliId ? CLI_BRAND_ICONS[cliId] : undefined;
  const row = (
    <button
      type="button"
      onClick={onFocus}
      aria-current={active ? "true" : undefined}
      className="flex min-w-0 flex-1 cursor-pointer items-center gap-8px text-left text-ui leading-none text-ink outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
    >
      {Brand ? (
        <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center">
          <Brand size={14} />
        </span>
      ) : (
        <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center text-ink">
          <Icon icon={TerminalSquare} size={14} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );

  return (
    <div
      className={cn(
        "group/thread flex w-full items-center gap-8px rounded-sm py-[3px] pl-[30px] pr-8px transition-colors duration-fast",
        active ? "bg-surface-strong" : "hover:bg-surface-strong/40",
      )}
    >
      {pathHint ? (
        <Tooltip content={pathHint} side="right">
          {row}
        </Tooltip>
      ) : (
        row
      )}
      {age ? (
        <span
          className={cn(
            "shrink-0 font-mono text-micro tabular-nums text-muted-soft",
            onClose && "group-hover/thread:hidden",
          )}
        >
          {age}
        </span>
      ) : null}
      {tabId ? <TabStatusDot tabId={tabId} /> : null}
      {onClose ? (
        <IconButton
          size="sm"
          aria-label={closeLabel ?? ""}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="opacity-0 transition-opacity duration-fast focus-visible:opacity-100 group-hover/thread:opacity-100"
        >
          <Icon icon={X} size={12} />
        </IconButton>
      ) : null}
    </div>
  );
}
