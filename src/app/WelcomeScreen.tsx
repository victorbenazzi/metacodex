import { FileText, FolderOpen, Github, SquareTerminal } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { MetacodexMark } from "@/components/icons/brand";
import { ResumeCards } from "@/components/resume/ResumeCards";
import { LaunchChip, LaunchStage } from "@/app/LaunchStage";

interface WelcomeScreenProps {
  onOpenFolder: () => void;
  onCloneFromGithub: () => void;
  onOpenTerminal: () => void;
  onOpenPreviewFile: () => void;
}

/** Empty work area with no project. Same stage as ProjectEmptyState; chips open a project. */
export function WelcomeScreen({
  onOpenFolder,
  onCloneFromGithub,
  onOpenTerminal,
  onOpenPreviewFile,
}: WelcomeScreenProps) {
  const { t } = useTranslation();

  return (
    <LaunchStage
      glyph={<MetacodexMark size={28} className="text-ink" />}
      title="metacodex"
      resume={<ResumeCards title={t("resume.titleGlobal")} limit={3} />}
      chips={
        <>
          <LaunchChip
            icon={FolderOpen}
            label={t("welcome.openProject")}
            onClick={onOpenFolder}
          />
          <LaunchChip
            icon={Github}
            label={t("welcome.cloneGithub")}
            onClick={onCloneFromGithub}
          />
          <LaunchChip
            icon={SquareTerminal}
            label={t("welcome.openTerminal")}
            onClick={onOpenTerminal}
          />
          <LaunchChip
            icon={FileText}
            label={t("welcome.openFile")}
            onClick={onOpenPreviewFile}
          />
        </>
      }
    />
  );
}
