import { useTranslation } from "react-i18next";

import { Folder, SquareTerminal } from "@/components/ui/icons";
import { Icon } from "@/components/ui/Icon";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import { lookupProjectGlyph } from "@/components/project-rail/projectIdentity";
import { DEFAULT_CLI_REGISTRY, type CliTool } from "@/features/terminal/cli-registry";
import { isCustomIcon } from "@/features/projects/customIcon.service";
import type { Project } from "@/features/projects/project.types";
import { ResumeCards } from "@/components/resume/ResumeCards";
import { LaunchChip, LaunchStage } from "@/app/LaunchStage";

interface ProjectEmptyStateProps {
  project: Project;
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
}

/** Empty work area with a project open. Same stage as WelcomeScreen; chips launch a session. */
export function ProjectEmptyState({ project, onNewTerminal, onLaunchCli }: ProjectEmptyStateProps) {
  const { t } = useTranslation();

  const usesCustom = isCustomIcon(project.icon);
  const FallbackIcon = usesCustom ? Folder : (lookupProjectGlyph(project.icon) ?? Folder);

  return (
    <LaunchStage
      glyph={
        usesCustom ? (
          <img
            src={project.icon}
            alt=""
            draggable={false}
            className="h-[28px] w-[28px] object-contain"
          />
        ) : (
          <FallbackIcon size={26} strokeWidth={1.5} className="text-ink" />
        )
      }
      title={project.name}
      meta={project.path}
      resume={
        <ResumeCards
          projectId={project.id}
          title={t("resume.titleProject", { name: project.name })}
          limit={5}
        />
      }
      chips={
        <>
          <LaunchChip
            icon={SquareTerminal}
            label={t("projectEmpty.openTerminal")}
            onClick={onNewTerminal}
          />
          {DEFAULT_CLI_REGISTRY.map((cli) => {
            const BrandIcon = CLI_BRAND_ICONS[cli.id];
            return (
              <LaunchChip
                key={cli.id}
                brand={BrandIcon ? <BrandIcon size={15} /> : <Icon icon={SquareTerminal} size={15} />}
                label={cli.label}
                onClick={() => onLaunchCli(cli)}
              />
            );
          })}
        </>
      }
    />
  );
}
