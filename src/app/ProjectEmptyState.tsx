import { useTranslation } from "react-i18next";

import { SquareTerminal } from "@/components/ui/icons";
import { Icon } from "@/components/ui/Icon";
import { CLI_BRAND_ICONS, MetacodexMark } from "@/components/icons/brand";
import type { CliTool } from "@/features/terminal/cli-registry";
import { useEnabledCliTools } from "@/features/terminal/useEnabledCliTools";
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
  const enabledCliTools = useEnabledCliTools();

  return (
    <LaunchStage
      glyph={<MetacodexMark size={26} className="text-ink" />}
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
          {enabledCliTools.map((cli) => {
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
