import { useTranslation } from "react-i18next";

import { Folder, TerminalSquare } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import { lookupProjectGlyph } from "@/components/project-rail/projectIdentity";
import { DEFAULT_CLI_REGISTRY, type CliTool } from "@/features/terminal/cli-registry";
import { isCustomIcon } from "@/features/projects/customIcon.service";
import type { Project } from "@/features/projects/project.types";
import { cn } from "@/lib/cn";
import { ResumeCards } from "@/components/resume/ResumeCards";

interface ProjectEmptyStateProps {
  project: Project;
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
}

/**
 * Shown in the work area when a project is open but has no tabs yet, distinct
 * from `WelcomeScreen` (no project at all). Same editorial language: project
 * icon + name as the hero, then the two ways to start working (a terminal, or a
 * dedicated button per AI agent). Reuses the project tile's icon logic so the
 * hero matches the rail.
 */
export function ProjectEmptyState({ project, onNewTerminal, onLaunchCli }: ProjectEmptyStateProps) {
  const { t } = useTranslation();

  const usesCustom = isCustomIcon(project.icon);
  const FallbackIcon = usesCustom ? Folder : (lookupProjectGlyph(project.icon) ?? Folder);

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-canvas">
      <div className="relative z-10 mx-auto flex w-full max-w-[760px] flex-col px-40px pt-64px">
        <span className="editorial-caps">{t("projectEmpty.eyebrow")}</span>

        {/* Hero: project icon + name + path */}
        <div className="mt-14px flex items-center gap-14px">
          <span
            aria-hidden
            className="flex shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-card"
            style={{ width: 44, height: 44 }}
          >
            {usesCustom ? (
              <img
                src={project.icon}
                alt=""
                draggable={false}
                className="h-[22px] w-[22px] object-contain"
              />
            ) : (
              <FallbackIcon size={20} strokeWidth={1.5} className="text-ink" />
            )}
          </span>
          <div className="min-w-0">
            <h1 className="break-words font-display text-display-s font-medium text-ink">
              {project.name}
            </h1>
            <p
              className="mt-[2px] truncate font-mono text-caption text-muted-soft"
              title={project.path}
            >
              {project.path}
            </p>
          </div>
        </div>

        <p className="mt-16px max-w-[520px] text-content text-body">
          {t("projectEmpty.tagline")}
        </p>

        {/* Resume tile group only renders when there are recent sessions for
            this project. Lives before the terminal/agent CTAs so it grabs
            attention as the "fast lane" back to in-flight work. */}
        <div className="mt-28px max-w-[640px]">
          <ResumeCards
            projectId={project.id}
            title={t("resume.titleProject", { name: project.name })}
            limit={5}
          />
        </div>

        {/* Primary: open a terminal */}
        <div className="mt-28px">
          <Button variant="primary" size="md" onClick={onNewTerminal}>
            <Icon icon={TerminalSquare} size={14} className="text-on-primary" />
            <span>{t("projectEmpty.openTerminal")}</span>
            <Kbd keys={["Mod", "T"]} className="ml-6px text-on-primary/70" />
          </Button>
        </div>

        {/* One button per AI agent */}
        <div className="mt-40px">
          <span className="editorial-caps text-muted-soft">{t("projectEmpty.agents")}</span>
          <div className="mt-14px grid max-w-[600px] grid-cols-2 gap-10px sm:grid-cols-3">
            {DEFAULT_CLI_REGISTRY.map((cli) => {
              const BrandIcon = CLI_BRAND_ICONS[cli.id];
              // Launcher rows stay quiet about detection state. Clicking a
              // missing CLI opens its tab with the CliMissingPanel guide.
              return (
                <button
                  key={cli.id}
                  type="button"
                  onClick={() => onLaunchCli(cli)}
                  className={cn(
                    "inline-flex h-[48px] w-full items-center gap-10px rounded-md border border-hairline bg-canvas-soft px-12px text-left",
                    "transition-colors duration-fast hover:border-hairline-strong hover:bg-surface-strong/40",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
                  )}
                >
                  {BrandIcon ? (
                    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <BrandIcon size={18} />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">
                    {cli.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
