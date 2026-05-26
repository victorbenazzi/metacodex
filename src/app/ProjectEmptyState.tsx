import * as Lucide from "lucide-react";
import { TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import { BackgroundGrain } from "@/components/ui/BackgroundGrain";
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import { DEFAULT_CLI_REGISTRY, type CliTool } from "@/features/terminal/cli-registry";
import { tileBackground, tileIconColor } from "@/features/projects/color";
import { isCustomIcon } from "@/features/projects/customIcon.service";
import { useThemeStore } from "@/features/theme/theme.store";
import type { Project } from "@/features/projects/project.types";
import { cn } from "@/lib/cn";
import { ResumeCards } from "@/components/resume/ResumeCards";

interface ProjectEmptyStateProps {
  project: Project;
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
}

function getLucideIcon(name: string): Lucide.LucideIcon {
  const I = (Lucide as unknown as Record<string, Lucide.LucideIcon>)[name];
  return I ?? Lucide.Folder;
}

/**
 * Shown in the work area when a project IS open but has no tabs yet — distinct
 * from `WelcomeScreen` (no project at all). Same editorial language: project
 * icon + name as the hero, then the two ways to start working (a terminal, or a
 * dedicated button per AI agent). Reuses the project tile's icon/color logic so
 * the hero matches the rail.
 */
export function ProjectEmptyState({ project, onNewTerminal, onLaunchCli }: ProjectEmptyStateProps) {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.effective);

  const usesCustom = isCustomIcon(project.icon);
  const FallbackIcon = usesCustom ? Lucide.Folder : getLucideIcon(project.icon);
  const bg = tileBackground(project.color, { theme, active: true, hover: false });
  const iconColor = tileIconColor(project.color, theme);

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-canvas">
      <BackgroundGrain />

      <div className="relative z-10 mx-auto flex w-full max-w-[760px] flex-col px-[40px] pt-[88px]">
        <span className="editorial-caps">{t("projectEmpty.eyebrow")}</span>

        {/* Hero: project icon + name + path */}
        <div className="mt-[18px] flex items-center gap-[18px]">
          <span
            aria-hidden
            className="flex shrink-0 items-center justify-center rounded-lg border border-hairline"
            style={{ width: 64, height: 64, backgroundColor: bg }}
          >
            {usesCustom ? (
              <img
                src={project.icon}
                alt=""
                draggable={false}
                className="h-[30px] w-[30px] object-contain"
              />
            ) : (
              <FallbackIcon size={28} strokeWidth={1.6} color={iconColor} />
            )}
          </span>
          <div className="min-w-0">
            <h1
              className="truncate font-display tracking-[-0.02em] text-ink"
              style={{ fontSize: "clamp(36px, 4.6vw, 56px)", lineHeight: 1.04, fontWeight: 500 }}
            >
              {project.name}
            </h1>
            <p
              className="mt-[4px] truncate font-mono text-[12px] text-muted-soft"
              title={project.path}
            >
              {project.path}
            </p>
          </div>
        </div>

        <p className="mt-[16px] max-w-[520px] font-display text-[17px] leading-[1.5] text-body">
          {t("projectEmpty.tagline")}
        </p>

        {/* Resume tile group — only renders when there are recent sessions for
            this project. Lives before the terminal/agent CTAs so it grabs
            attention as the "fast lane" back to in-flight work. */}
        <div className="mt-[28px] max-w-[640px]">
          <ResumeCards
            projectId={project.id}
            title={t("resume.titleProject", { name: project.name })}
            limit={5}
          />
        </div>

        {/* Primary: open a terminal */}
        <div className="mt-[28px]">
          <button
            type="button"
            onClick={onNewTerminal}
            className={cn(
              "inline-flex h-[36px] items-center gap-[8px] rounded-sm bg-ink px-[16px] text-[13px] font-medium text-on-primary",
              "transition-colors duration-150 hover:bg-primary-active",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[3px]",
            )}
          >
            <Icon icon={TerminalSquare} size={14} className="text-on-primary" />
            <span>{t("projectEmpty.openTerminal")}</span>
            <Kbd keys={["Mod", "T"]} className="ml-[6px] text-on-primary/70" />
          </button>
        </div>

        {/* One button per AI agent */}
        <div className="mt-[40px]">
          <span className="editorial-caps text-muted-soft">{t("projectEmpty.agents")}</span>
          <div className="mt-[14px] grid max-w-[600px] grid-cols-2 gap-[10px] sm:grid-cols-3">
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
                    "inline-flex h-[48px] w-full items-center gap-[10px] rounded-sm border border-hairline bg-canvas-soft px-[12px] text-left",
                    "transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-strong/40",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
                  )}
                >
                  {BrandIcon ? (
                    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <BrandIcon size={18} />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
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

