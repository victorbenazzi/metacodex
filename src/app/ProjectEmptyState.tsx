import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Folder } from "@/components/ui/icons";
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

/** Staggered entrance: each block rises in sequence (respects reduced motion). */
function Rise({ delay, className, children }: { delay: number; className?: string; children: ReactNode }) {
  const style: CSSProperties = { animationDelay: `${delay}ms` };
  return (
    <div className={cn("animate-rise-in motion-reduce:animate-none", className)} style={style}>
      {children}
    </div>
  );
}

/**
 * Shown in the work area when a project is open but has no tabs yet, distinct
 * from `WelcomeScreen` (no project at all). A centered "launch stage": the
 * project glyph as hero over an accent bloom, a command-palette-styled bar as
 * the single primary action, recent sessions as the fast lane, and one chip
 * per AI agent. Backdrop is the token atmosphere plus a masked dot lattice.
 * Reuses the project tile's icon logic so the hero matches the rail.
 */
export function ProjectEmptyState({ project, onNewTerminal, onLaunchCli }: ProjectEmptyStateProps) {
  const { t } = useTranslation();

  const usesCustom = isCustomIcon(project.icon);
  const FallbackIcon = usesCustom ? Folder : (lookupProjectGlyph(project.icon) ?? Folder);

  return (
    <div className="relative h-full w-full overflow-y-auto bg-canvas">
      <div aria-hidden className="dot-grid pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex min-h-full w-full flex-col items-center px-40px">
        <div className="my-auto flex w-full max-w-[640px] flex-col items-center py-40px">
          {/* Hero: project glyph over an accent bloom, name, path */}
          <Rise delay={40} className="flex flex-col items-center text-center">
            <div className="relative mb-18px" style={{ width: 64, height: 64 }}>
              <div
                aria-hidden
                className="accent-bloom pointer-events-none absolute -inset-[70px]"
              />
              <span
                aria-hidden
                className="relative flex h-full w-full items-center justify-center rounded-xl border border-hairline bg-gradient-to-b from-surface-card to-canvas-soft shadow-elevated"
              >
                {usesCustom ? (
                  <img
                    src={project.icon}
                    alt=""
                    draggable={false}
                    className="h-[28px] w-[28px] object-contain"
                  />
                ) : (
                  <FallbackIcon size={26} strokeWidth={1.5} className="text-ink" />
                )}
              </span>
            </div>

            <h1 className="max-w-full break-words font-display text-display font-medium leading-[1.1] text-ink">
              {project.name}
            </h1>

            <span
              className="mt-12px inline-flex max-w-full items-center rounded-pill border border-hairline bg-surface-card/60 px-12px py-4px font-mono text-label text-muted"
              title={project.path}
            >
              <span className="truncate">{project.path}</span>
            </span>
          </Rise>

          {/* Primary: the command bar. One action, keyboard-first. */}
          <Rise delay={100} className="mt-32px w-full max-w-[560px]">
            <button
              type="button"
              onClick={onNewTerminal}
              className={cn(
                "press-feedback flex h-[54px] w-full items-center gap-12px rounded-lg border border-hairline bg-surface-card px-18px shadow-elevated",
                "transition-all duration-base hover:border-accent/30 hover:ring-[3px] hover:ring-accent/10",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
              )}
            >
              <span aria-hidden className="font-mono text-title font-semibold text-accent">
                ❯
              </span>
              <span className="text-content font-medium text-ink">
                {t("projectEmpty.openTerminal")}
              </span>
              <span className="hidden text-ui text-muted-soft sm:inline">
                {t("projectEmpty.terminalHint")}
              </span>
              <span className="flex-1" />
              <Kbd keys={["Mod", "T"]} />
            </button>
          </Rise>

          {/* Fast lane: recent sessions (self-hides when empty) */}
          <Rise delay={160} className="mt-32px w-full max-w-[560px] empty:mt-0">
            <ResumeCards
              projectId={project.id}
              title={t("resume.titleProject", { name: project.name })}
              limit={5}
            />
          </Rise>

          {/* One chip per AI agent */}
          <Rise delay={220} className="mt-32px flex w-full flex-col items-center gap-12px">
            <span className="editorial-caps text-muted-soft">{t("projectEmpty.agentsLead")}</span>
            <div className="flex flex-wrap justify-center gap-8px">
              {DEFAULT_CLI_REGISTRY.map((cli) => {
                const BrandIcon = CLI_BRAND_ICONS[cli.id];
                // Chips stay quiet about detection state. Clicking a missing
                // CLI opens its tab with the CliMissingPanel guide.
                return (
                  <button
                    key={cli.id}
                    type="button"
                    onClick={() => onLaunchCli(cli)}
                    className={cn(
                      "inline-flex h-[36px] items-center gap-8px rounded-pill border border-hairline bg-surface-card/70 pl-11px pr-14px",
                      "text-ui font-medium text-body",
                      "transition-colors duration-fast hover:border-accent/30 hover:bg-surface-card hover:text-ink",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
                    )}
                  >
                    {BrandIcon ? (
                      <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center">
                        <BrandIcon size={15} />
                      </span>
                    ) : null}
                    <span className="truncate">{cli.label}</span>
                  </button>
                );
              })}
            </div>
          </Rise>

          {/* Keyboard identity footer */}
          <Rise
            delay={280}
            className="mt-56px flex flex-wrap items-center justify-center gap-x-22px gap-y-8px font-mono text-label text-muted-soft"
          >
            <span className="inline-flex items-center gap-7px">
              <Kbd keys={["Mod", "Shift", "P"]} />
              {t("projectEmpty.hintCommands")}
            </span>
            <span className="inline-flex items-center gap-7px">
              <Kbd keys={["Mod", "P"]} />
              {t("projectEmpty.hintFiles")}
            </span>
            <span className="inline-flex items-center gap-7px">
              <Kbd keys={["Mod", "T"]} />
              {t("projectEmpty.hintTerminal")}
            </span>
          </Rise>
        </div>
      </div>
    </div>
  );
}
