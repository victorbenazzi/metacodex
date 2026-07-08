import { useEffect, useRef, useState } from "react";
import { ChevronLeft, GitBranch, SquareTerminal } from "lucide-react";
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
import { isRemoteProject } from "@/features/projects/project.types";
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
  const remoteProject = isRemoteProject(project);
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

  // Height choreography: in launcher mode the card hugs its content; opening
  // Git and Review expands it to the full column. A flex-grow transition can't
  // animate this (the review content is taller than the column, so the
  // resolved height snaps to full on the first frame), so both endpoints are
  // measured in px and the transition runs on `height`:
  //   - frameH: the available column height (ResizeObserver on the frame).
  //   - launcherH: the launcher's natural content height, measured from the
  //     scroll container while observing the inner block (the scroll box
  //     itself doesn't resize when its CONTENT changes, the block does).
  // launcherH intentionally survives while review is open: it's the target
  // the collapse animates back to.
  const frameRef = useRef<HTMLDivElement | null>(null);
  const launcherScrollRef = useRef<HTMLDivElement | null>(null);
  const launcherBlockRef = useRef<HTMLDivElement | null>(null);
  const [frameH, setFrameH] = useState<number | null>(null);
  const [launcherH, setLauncherH] = useState<number | null>(null);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const sync = () => setFrameH(el.clientHeight);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const block = launcherBlockRef.current;
    const scroll = launcherScrollRef.current;
    if (!block || !scroll) return;
    // Measure the CONTENT block, never the scroll box: scrollHeight is floored
    // at the box's own height, so while the card is still expanded (collapse
    // in flight) it would report the full column and wedge the card open.
    const sync = () => {
      const cs = getComputedStyle(scroll);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      // +2 for the card's top/bottom borders.
      setLauncherH(Math.ceil(block.offsetHeight + pad) + 2);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(block);
    return () => ro.disconnect();
  }, [activeTool]);

  const collapsedH =
    launcherH !== null && frameH !== null ? Math.min(launcherH, frameH) : null;
  const asideHeight =
    activeTool === "review" ? frameH ?? undefined : collapsedH ?? undefined;

  return (
    <div ref={frameRef} className="h-full min-h-0">
    <aside
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-hairline bg-surface-card",
        "transition-[height] duration-base ease-out motion-reduce:transition-none",
      )}
      // Undefined until the first measurement: the card renders height:auto,
      // which visually equals the measured collapsed height, so nothing jumps.
      style={{ height: asideHeight }}
      aria-label={t("sidePanel.title")}
    >
      {activeTool === "review" ? (
        <>
          <header className="flex h-[var(--panel-header-h)] shrink-0 items-center gap-[6px] border-b border-hairline-soft px-[8px]">
            <Tooltip content={t("sidePanel.showTools")} side="bottom">
              <IconButton
                aria-label={t("sidePanel.showTools")}
                size="md"
                onClick={() => setActiveTool(null)}
              >
                <Icon icon={ChevronLeft} size={14} />
              </IconButton>
            </Tooltip>
            <div className="flex min-w-0 flex-1 items-center gap-[7px] text-caption text-ink">
              <Icon icon={GitBranch} size={12} className="shrink-0" />
              <span className="truncate">{t("sidePanel.review")}</span>
              {changeCount > 0 ? (
                <span className="shrink-0 text-micro tabular-nums text-muted-soft">
                  {changeCount > 99 ? "99+" : changeCount}
                </span>
              ) : null}
            </div>
          </header>
          <div className="min-h-0 flex-1">
            {project && !remoteProject ? (
              <SourceControlPanel
                projectId={project.id}
                projectPath={project.path}
                onOpenDiff={onOpenDiff}
              />
            ) : (
              <div className="h-full min-h-0">
                <EmptyState body={remoteProject ? t("sourceControl.remoteUnsupported") : t("sourceControl.noProject")} />
              </div>
            )}
          </div>
        </>
      ) : (
        <div
          ref={launcherScrollRef}
          className="flex min-h-0 flex-1 overflow-y-auto px-[20px] py-[16px]"
        >
          {/* self-start opts out of the flex row's default align stretch: the
              block must keep its natural content height at all times, it is
              the source of truth for the card's collapsed height. */}
          <div
            ref={launcherBlockRef}
            className="mx-auto w-full max-w-[420px] self-start space-y-[18px]"
          >
            {remoteProject ? null : (
              <LauncherSection label={t("sidePanel.sections.repository")}>
                <LauncherRow
                  icon={<Icon icon={GitBranch} size={14} />}
                  label={t("sidePanel.review")}
                  trailing={
                    changeCount > 0 ? (
                      <span className="font-mono text-micro tabular-nums text-muted-soft">
                        {changeCount > 99 ? "99+" : changeCount}
                      </span>
                    ) : null
                  }
                  onClick={() => setActiveTool("review")}
                />
              </LauncherSection>
            )}

            <LauncherSection label={t("sidePanel.sections.workspace")}>
              <LauncherRow
                icon={<Icon icon={SquareTerminal} size={14} />}
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
    </div>
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
        "flex h-[40px] w-full items-center gap-[10px] rounded-sm bg-surface-strong/20 px-[12px] text-left text-ui text-body",
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
          <Icon icon={SquareTerminal} size={14} />
        )
      }
      label={cli.label}
      onClick={onClick}
    />
  );
}
