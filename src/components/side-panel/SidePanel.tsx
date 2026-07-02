import {
  ChevronLeft,
  GitBranch,
  PanelRightClose,
  SquareTerminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Kbd } from "@/components/ui/Kbd";
import { Tooltip } from "@/components/ui/Tooltip";
import { SourceControlPanel } from "@/components/source-control/SourceControlPanel";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import type { CliTool } from "@/features/terminal/cli-registry";
import {
  DEFAULT_CLI_REGISTRY,
  cliCategory,
  isAgentEnabled,
} from "@/features/terminal/cli-registry";
import type { Project } from "@/features/projects/project.types";
import { useGitStore } from "@/features/git/git.store";
import { useSidePanelStore } from "@/features/side-panel/sidePanel.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { cn } from "@/lib/cn";

interface SidePanelProps {
  project: Project | null;
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
  onOpenDiff: (path: string, status: string) => void;
}

export function SidePanel({
  project,
  onNewTerminal,
  onLaunchCli,
  onOpenDiff,
}: SidePanelProps) {
  const { t } = useTranslation();
  const activeTool = useSidePanelStore((s) => s.activeTool);
  const setActiveTool = useSidePanelStore((s) => s.setActiveTool);
  const setOpen = useSidePanelStore((s) => s.setOpen);
  const git = useGitStore((s) => (project ? s.byProject[project.id] : null));
  const changeCount = git ? Object.keys(git.statuses).length : 0;
  const enabledAgents = useSettingsDataStore((s) => s.settings.interface.enabledAgents);
  const visibleAgents = DEFAULT_CLI_REGISTRY.filter((cli) =>
    isAgentEnabled(cli.id, enabledAgents),
  );
  const codingAgents = visibleAgents.filter((cli) => cliCategory(cli) === "coding");
  const autonomousAgents = visibleAgents.filter((cli) => cliCategory(cli) === "autonomous");

  const openLauncherAction = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l border-hairline bg-canvas"
      aria-label={t("sidePanel.title")}
    >
      {activeTool === "review" ? (
        <>
          <header className="flex h-[34px] shrink-0 items-center gap-[6px] border-b border-hairline-soft bg-canvas-soft px-[8px]">
            <Tooltip content={t("sidePanel.showTools")} side="bottom">
              <IconButton
                aria-label={t("sidePanel.showTools")}
                size="md"
                onClick={() => setActiveTool(null)}
              >
                <Icon icon={ChevronLeft} size={14} />
              </IconButton>
            </Tooltip>
            <div className="flex min-w-0 flex-1 items-center gap-[7px] font-mono text-caption text-ink">
              <Icon icon={GitBranch} size={12} strokeWidth={1.8} className="shrink-0" />
              <span className="truncate">{t("sidePanel.review")}</span>
              {changeCount > 0 ? (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-soft">
                  {changeCount > 99 ? "99+" : changeCount}
                </span>
              ) : null}
            </div>
            <Tooltip content={t("sidePanel.close")} side="bottom">
              <IconButton
                aria-label={t("sidePanel.close")}
                size="md"
                onClick={() => setOpen(false)}
              >
                <Icon icon={PanelRightClose} size={14} />
              </IconButton>
            </Tooltip>
          </header>
          <div className="min-h-0 flex-1">
            {project ? (
              <SourceControlPanel
                projectId={project.id}
                projectPath={project.path}
                onOpenDiff={onOpenDiff}
              />
            ) : (
              <div className="h-full min-h-0">
                <EmptyState body={t("sourceControl.noProject")} />
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-y-auto px-[20px] py-[28px]">
          <div className="m-auto w-full max-w-[420px] space-y-[18px]">
            <LauncherSection label={t("sidePanel.sections.repository")}>
              <LauncherRow
                icon={<Icon icon={GitBranch} size={13} />}
                label={t("sidePanel.review")}
                trailing={
                  changeCount > 0 ? (
                    <span className="font-mono text-[10px] tabular-nums text-muted-soft">
                      {changeCount > 99 ? "99+" : changeCount}
                    </span>
                  ) : null
                }
                onClick={() => setActiveTool("review")}
              />
            </LauncherSection>

            <LauncherSection label={t("sidePanel.sections.workspace")}>
              <LauncherRow
                icon={<Icon icon={SquareTerminal} size={13} />}
                label={t("tabs.newTerminal")}
                trailing={<Kbd keys={["Mod", "T"]} />}
                onClick={() => openLauncherAction(onNewTerminal)}
              />
            </LauncherSection>

            {codingAgents.length > 0 ? (
              <LauncherSection label={t("tabs.codingAgents")}>
                {codingAgents.map((cli) => (
                  <AgentLauncherRow
                    key={cli.id}
                    cli={cli}
                    onClick={() => openLauncherAction(() => onLaunchCli(cli))}
                  />
                ))}
              </LauncherSection>
            ) : null}

            {autonomousAgents.length > 0 ? (
              <LauncherSection label={t("tabs.autonomousAgents")}>
                {autonomousAgents.map((cli) => (
                  <AgentLauncherRow
                    key={cli.id}
                    cli={cli}
                    onClick={() => openLauncherAction(() => onLaunchCli(cli))}
                  />
                ))}
              </LauncherSection>
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
}

interface LauncherRowProps {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onClick: () => void;
}

function LauncherSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-[6px]">
      <div className="px-[2px] editorial-caps text-muted-soft">
        {label}
      </div>
      <div className="space-y-[4px]">{children}</div>
    </section>
  );
}

function LauncherRow({ icon, label, trailing, onClick }: LauncherRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-[40px] w-full items-center gap-[11px] rounded-sm bg-surface-strong/20 px-[11px] text-left text-ui text-body",
        "border border-transparent transition-colors duration-fast hover:border-hairline-soft hover:bg-surface-strong/50 hover:text-ink",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
      )}
    >
      <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? <span className="shrink-0 text-muted-soft">{trailing}</span> : null}
    </button>
  );
}

function AgentLauncherRow({ cli, onClick }: { cli: CliTool; onClick: () => void }) {
  const BrandIcon = CLI_BRAND_ICONS[cli.id];
  return (
    <LauncherRow
      icon={
        BrandIcon ? (
          <span className="flex h-[16px] w-[16px] items-center justify-center">
            <BrandIcon size={14} />
          </span>
        ) : (
          <Icon icon={SquareTerminal} size={13} />
        )
      }
      label={cli.label}
      onClick={onClick}
    />
  );
}
