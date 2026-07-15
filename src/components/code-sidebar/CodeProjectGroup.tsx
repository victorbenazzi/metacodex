import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Bot, FolderOpen, MoreHorizontal, Pencil, Plus, SquareTerminal, Trash2, X } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { SidebarChevron, SidebarNest, SidebarRow } from "@/components/ui/SidebarRow";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { cn } from "@/lib/cn";
import { basename } from "@/lib/path";
import { agoShort } from "@/lib/time";
import { CMD, invoke } from "@/lib/ipc";
import { FileIcon } from "@/components/file-explorer/FileIcon";
import { ProjectGlyph } from "@/components/project-rail/ProjectGlyph";
import { ProjectContextMenu } from "@/components/project-rail/ProjectContextMenu";
import { ProjectStatusDot } from "@/components/project-rail/ProjectStatusDot";
import { NewTabBody, DROPDOWN_COMPONENTS } from "@/components/tabs/NewTabMenu";
import { TabStatusDot } from "@/components/tabs/TabStatusDot";
import { statusTone } from "@/components/tabs/statusTone";
import { useProjectsStore } from "@/features/projects/project.store";
import { tileIconColor } from "@/features/projects/color";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { useThemeStore } from "@/features/theme/theme.store";
import { useProjectAgentStatus } from "@/features/terminal/projectStatus";
import { useCodeSidebarStore } from "@/features/ui/codeSidebar.store";
import { useResumeStore } from "@/features/resume/resume.store";
import { buildResumeTab } from "@/features/resume/resumeLaunch";
import { resumeFlagFor } from "@/features/resume/sessionDetectors";
import { cliById, type CliTool } from "@/features/terminal/cli-registry";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import { useTabsStore } from "@/components/tabs/tabsStore";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { useTabMetadataStore, type ListeningPort } from "@/features/terminal/tabMetadata.store";
import type { Project } from "@/features/projects/project.types";
import type { ResumeEntry } from "@/features/resume/resume.service";
import { resolveTabTitle, type Tab } from "@/components/tabs/types";
import { openCli, openTerminal, requestCloseTab } from "@/features/tabs";

const HISTORY_CAP = 6;

/**
 * One project parent row over its nested Code sections (built on the shared
 * `SidebarRow`). In `horizontal` layout the section list is just Histórico
 * (the open items live in the top tab bar, so the sidebar never duplicates
 * them). In `vertical` layout (no top tab bar) it adds
 * Agentes (agent CLIs, with their listening-port chips), Terminais (shells)
 * and Arquivos (open file tabs), and clicking a row makes that tab the single
 * center pane. Empty sections stay hidden. The parent row also carries the
 * project-level rollups: the accent bar + medium label when active, and the
 * aggregated session status dot (working / needs-attention / done).
 */
export function CodeProjectGroup({
  project,
  active,
  onRequestRename,
  onRequestRemove,
}: {
  project: Project;
  active: boolean;
  onRequestRename: (project: Project) => void;
  onRequestRemove: (project: Project) => void;
}) {
  const { t } = useTranslation();
  const layoutMode = useSettingsDataStore((s) => s.settings.interface.layoutMode);
  const setActive = useProjectsStore((s) => s.setActive);
  const expandedProjects = useCodeSidebarStore((s) => s.expandedProjects);
  const setProjectExpanded = useCodeSidebarStore((s) => s.setProjectExpanded);

  const explicit = expandedProjects[project.id];
  const expanded = explicit ?? active; // active project opens by default
  const collapsed = !expanded;
  const vertical = layoutMode === "vertical";

  // --- Section data (subscribed always; only rendered when expanded) ---------
  const resumeEntries = useResumeStore((s) => s.entries);
  const historico = useMemo(
    () =>
      resumeEntries
        .filter((e) => e.projectId === project.id && resumeFlagFor(e.cliId) !== null)
        .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
        .slice(0, HISTORY_CAP),
    [resumeEntries, project.id],
  );

  const bucket = useTabsStore((s) => s.byProject[project.id]);
  const terminais = useMemo(
    () => (bucket?.tabs ?? []).filter((tab) => tab.kind === "terminal"),
    [bucket],
  );
  const agentes = useMemo(
    () => (bucket?.tabs ?? []).filter((tab) => tab.kind === "cli"),
    [bucket],
  );
  // Open file tabs (editor/markdown/image/pdf/diff). In vertical layout the
  // top tab bar is gone, so this section is the ONLY place these tabs can be
  // switched or closed from.
  const arquivos = useMemo(
    () =>
      (bucket?.tabs ?? []).filter(
        (tab) => tab.kind !== "terminal" && tab.kind !== "cli",
      ),
    [bucket],
  );

  // Project-level rollup: worst per-tab status + live session count. Drives
  // the always-visible dot on the parent row so "which project is running or
  // waiting on me" reads without expanding anything.
  const { status: aggStatus, urgency: aggUrgency, sessionCount } = useProjectAgentStatus(
    project.id,
  );
  const aggTone = aggStatus ? statusTone(aggStatus, aggUrgency) : null;

  const theme = useThemeStore((s) => s.effective);
  const accent = tileIconColor(project.color, theme);

  const sessions = useTerminalStore((s) => s.sessions);
  const portsBySession = useTabMetadataStore((s) => s.bySessionId);
  // Index the listening ports by the tab that owns the session, once per change,
  // instead of scanning every session for each rendered row.
  const portsByTabId = useMemo(() => {
    const out: Record<string, ListeningPort[]> = {};
    for (const session of Object.values(sessions)) {
      if (!session.tabId) continue;
      const ports = portsBySession[session.id]?.listeningPorts;
      if (ports && ports.length) out[session.tabId] = ports;
    }
    return out;
  }, [sessions, portsBySession]);

  // --- Actions ---------------------------------------------------------------
  const openTab = useTabsStore((s) => s.openTab);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);

  const resume = (entry: ResumeEntry) => {
    void setActive(project.id);
    const tab = buildResumeTab(entry);
    if (tab) openTab(project.id, tab);
  };
  const focusTab = (tabId: string) => {
    void setActive(project.id);
    setActiveTab(project.id, tabId);
  };
  // Same Tab lifecycle path as the tab bar (confirm Process tabs, then stop + close).
  const closeTabHere = (tabId: string) => {
    requestCloseTab(project.id, bucket?.tabs ?? [], tabId);
  };
  // The "+" menu creates the tab in THIS project (and makes it active) rather
  // than the globally-active one, so it works from any project row.
  const newTerminalHere = () => {
    void setActive(project.id);
    openTerminal({
      projectKey: project.id,
      projectId: project.id,
      cwd: project.path,
      title: project.name,
    });
  };
  const launchCliHere = (cli: CliTool) => {
    void setActive(project.id);
    openCli({
      projectKey: project.id,
      projectId: project.id,
      cwd: project.path,
      cli,
    });
  };
  const revealInFinder = () => {
    void invoke(CMD.revealInFinder, { path: project.path });
  };

  // Open tab sections (Agentes/Terminais/Arquivos) only live here in vertical
  // layout; in horizontal layout the top tab bar already shows them.
  const showOpen = vertical;
  const hasContent =
    historico.length > 0 ||
    (showOpen && (terminais.length > 0 || agentes.length > 0 || arquivos.length > 0));

  // Hover-revealed trailing controls (new-tab "+", project options "⋯").
  const trailingBtn = cn(
    "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm text-muted-soft transition-colors duration-fast",
    "hover:bg-surface-strong/55 hover:text-ink focus-visible:opacity-100",
    "opacity-0 group-hover/proj:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-surface-strong/55 data-[state=open]:text-ink",
  );

  return (
    <div>
      <ProjectContextMenu
        project={project}
        onRequestRename={() => onRequestRename(project)}
        onRequestRemove={() => onRequestRemove(project)}
      >
        <SidebarRow
          active={active}
          accent={accent}
          leading={<ProjectGlyph project={project} size={16} />}
          label={project.name}
          title={project.path}
          onActivate={() => {
            void setActive(project.id);
            setProjectExpanded(project.id, true);
          }}
          trailing={
            <div className="flex items-center gap-[1px]" data-no-drag>
              {aggStatus && aggTone ? (
                <Tooltip
                  content={
                    <span className="flex flex-col gap-[2px]">
                      <span className="font-medium">{t(aggTone.labelKey)}</span>
                      <span className="font-mono text-micro text-muted">
                        {t("projectRail.sessions", { count: sessionCount })}
                      </span>
                    </span>
                  }
                  side="bottom"
                >
                  <span className="mr-[5px] inline-flex">
                    <ProjectStatusDot
                      status={aggStatus}
                      urgency={aggUrgency}
                      label={t(aggTone.labelKey)}
                    />
                  </span>
                </Tooltip>
              ) : null}
              <DropdownRoot>
                <Tooltip content={t("codeSidebar.newInProject")} side="bottom">
                  <DropdownTrigger asChild>
                    <button type="button" aria-label={t("codeSidebar.newInProject")} className={trailingBtn}>
                      <Icon icon={Plus} size={12} />
                    </button>
                  </DropdownTrigger>
                </Tooltip>
                <DropdownContent align="start" sideOffset={6}>
                  <NewTabBody
                    actions={{ onNewTerminal: newTerminalHere, onLaunchCli: launchCliHere }}
                    C={DROPDOWN_COMPONENTS}
                  />
                </DropdownContent>
              </DropdownRoot>

              <DropdownRoot>
                <Tooltip content={t("codeSidebar.projectOptions")} side="bottom">
                  <DropdownTrigger asChild>
                    <button type="button" aria-label={t("codeSidebar.projectOptions")} className={trailingBtn}>
                      <Icon icon={MoreHorizontal} size={12} />
                    </button>
                  </DropdownTrigger>
                </Tooltip>
                <DropdownContent align="start" sideOffset={6} className="min-w-[180px]">
                  <DropdownItem onSelect={() => onRequestRename(project)}>
                    <Icon icon={Pencil} size={12} className="text-muted" />
                    {t("projectRail.menu.rename")}
                  </DropdownItem>
                  <DropdownItem onSelect={revealInFinder}>
                    <Icon icon={FolderOpen} size={12} className="text-muted" />
                    {t("projectRail.menu.revealInFinder")}
                  </DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem
                    className="text-danger data-[highlighted]:bg-danger/10 data-[highlighted]:text-danger"
                    onSelect={() => onRequestRemove(project)}
                  >
                    <Icon icon={Trash2} size={12} />
                    {t("projectRail.menu.removeFromApp")}
                  </DropdownItem>
                </DropdownContent>
              </DropdownRoot>

              {hasContent ? (
                <SidebarChevron
                  collapsed={collapsed}
                  onToggle={() => setProjectExpanded(project.id, collapsed)}
                  expandLabel={t("codeSidebar.expandProject")}
                  collapseLabel={t("codeSidebar.collapseProject")}
                />
              ) : null}
            </div>
          }
        />
      </ProjectContextMenu>

      {!collapsed && hasContent ? (
        // data-no-drag: presses on nested rows never start a project reorder;
        // only the parent row above is a drag handle (see useListReorder).
        <div data-no-drag>
          <SidebarNest>
            {historico.length > 0 ? (
              <Section label={t("codeSidebar.historico")} count={historico.length}>
                {historico.map((entry) => (
                  <HistoricoRow key={entry.id} entry={entry} onResume={resume} />
                ))}
              </Section>
            ) : null}

            {showOpen && agentes.length > 0 ? (
              <Section label={t("codeSidebar.agentes")} count={agentes.length}>
                {agentes.map((tab) => (
                  <TabRow
                    key={tab.id}
                    tab={tab}
                    ports={portsByTabId[tab.id] ?? []}
                    onFocus={focusTab}
                    onClose={closeTabHere}
                  />
                ))}
              </Section>
            ) : null}

            {showOpen && terminais.length > 0 ? (
              <Section label={t("codeSidebar.terminais")} count={terminais.length}>
                {terminais.map((tab) => (
                  <TabRow
                    key={tab.id}
                    tab={tab}
                    ports={portsByTabId[tab.id] ?? []}
                    onFocus={focusTab}
                    onClose={closeTabHere}
                  />
                ))}
              </Section>
            ) : null}

            {showOpen && arquivos.length > 0 ? (
              <Section label={t("codeSidebar.arquivos")} count={arquivos.length}>
                {arquivos.map((tab) => (
                  <FileRow
                    key={tab.id}
                    tab={tab}
                    onFocus={focusTab}
                    onClose={closeTabHere}
                  />
                ))}
              </Section>
            ) : null}
          </SidebarNest>
        </div>
      ) : null}
    </div>
  );
}

function Section({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <div className="pt-[4px]">
      <div className="flex items-center justify-between px-[8px] pb-[1px] pt-[2px]">
        <span className="text-label font-medium text-muted-soft">
          {label}
        </span>
        <span className="font-mono text-micro tabular-nums text-muted-soft">{count}</span>
      </div>
      <div className="flex flex-col gap-[1px]">{children}</div>
    </div>
  );
}

interface RowShellProps {
  leading: ReactNode;
  label: string;
  trailing?: ReactNode;
  title?: string;
  ariaLabel?: string;
  onClick: () => void;
  /** Hover-revealed close button that kills the row's process. Omit for rows
   *  without a live process (e.g. Histórico). */
  onClose?: () => void;
  closeLabel?: string;
}

function RowShell({ leading, label, trailing, title, ariaLabel, onClick, onClose, closeLabel }: RowShellProps) {
  return (
    <div
      className={cn(
        "group/row flex w-full items-center gap-[8px] rounded-sm px-[8px] py-[4px] text-ui text-body transition-colors duration-fast",
        "hover:bg-surface-strong/40 hover:text-ink",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        title={title}
        className="flex min-w-0 flex-1 items-center gap-[8px] rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
      >
        <span className="grid h-[16px] w-[16px] shrink-0 place-items-center text-muted">{leading}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      {trailing}
      {onClose ? (
        <IconButton
          size="sm"
          aria-label={closeLabel ?? ""}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="opacity-0 transition-opacity duration-fast focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          <Icon icon={X} size={12} />
        </IconButton>
      ) : null}
    </div>
  );
}

function HistoricoRow({
  entry,
  onResume,
}: {
  entry: ResumeEntry;
  onResume: (entry: ResumeEntry) => void;
}) {
  const { t } = useTranslation();
  const cli = cliById(entry.cliId);
  const label = cli?.label ?? entry.cliId;
  const BrandIcon = cli ? CLI_BRAND_ICONS[cli.id] : undefined;
  const primary = entry.branch || basename(entry.cwd) || label;
  return (
    <RowShell
      leading={BrandIcon ? <BrandIcon size={12} /> : <Icon icon={SquareTerminal} size={12} />}
      label={primary}
      trailing={
        <span className="shrink-0 font-mono text-micro tabular-nums text-muted-soft">
          {agoShort(entry.lastSeenAt)}
        </span>
      }
      title={`${label} · ${entry.cwd}`}
      ariaLabel={t("codeSidebar.resumeAria", { cli: label })}
      onClick={() => onResume(entry)}
    />
  );
}

/** A single open terminal or agent-CLI tab. Shows listening-port chips (dev
 *  servers) plus the agent status dot, and focuses the tab on click. */
function TabRow({
  tab,
  ports,
  onFocus,
  onClose,
}: {
  tab: Tab;
  ports: ListeningPort[];
  onFocus: (tabId: string) => void;
  onClose: (tabId: string) => void;
}) {
  const { t } = useTranslation();
  const cliId = tab.kind === "cli" ? tab.cliId : undefined;
  const BrandIcon = cliId ? CLI_BRAND_ICONS[cliId] : undefined;
  const leading = BrandIcon ? (
    <BrandIcon size={12} />
  ) : (
    <Icon icon={tab.kind === "cli" ? Bot : SquareTerminal} size={12} />
  );
  return (
    <RowShell
      leading={leading}
      label={resolveTabTitle(tab)}
      trailing={
        <span className="flex shrink-0 items-center gap-[4px]">
          {ports.slice(0, 2).map((p) => (
            <span
              key={`${p.address}:${p.port}`}
              className="rounded-xs border border-hairline px-[4px] font-mono text-micro tabular-nums text-muted-soft"
            >
              :{p.port}
            </span>
          ))}
          <TabStatusDot tabId={tab.id} />
        </span>
      }
      onClick={() => onFocus(tab.id)}
      onClose={() => onClose(tab.id)}
      closeLabel={t(tab.kind === "cli" ? "codeSidebar.endAgent" : "codeSidebar.endTerminal")}
    />
  );
}

/** A single open file tab (editor/markdown/image/pdf/diff). In vertical
 *  layout this is the only surface where file tabs can be switched or closed,
 *  since the top tab bar is hidden there. Shows the unsaved-changes dot. */
function FileRow({
  tab,
  onFocus,
  onClose,
}: {
  tab: Tab;
  onFocus: (tabId: string) => void;
  onClose: (tabId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <RowShell
      leading={<FileIcon isDir={false} filename={tab.title} size={12} />}
      label={tab.title}
      trailing={
        tab.dirty ? (
          <span
            aria-label={t("tabs.unsavedChanges")}
            className="inline-block h-[5px] w-[5px] shrink-0 rounded-pill bg-ink/60"
          />
        ) : undefined
      }
      onClick={() => onFocus(tab.id)}
      onClose={() => onClose(tab.id)}
      closeLabel={t("codeSidebar.closeFile")}
    />
  );
}
