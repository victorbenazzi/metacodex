import type { Tab } from "./types";
import { TabContent } from "./TabContent";
import { WelcomeScreen } from "@/app/WelcomeScreen";
import { ProjectEmptyState } from "@/app/ProjectEmptyState";
import { isProcessTab } from "@/features/tabs";
import type { CliTool } from "@/features/terminal/cli-registry";
import type { Project } from "@/features/projects/project.types";

interface TabsBucketLike {
  tabs: Tab[];
  activeTabId: string | null;
}

interface WorkAreaProps {
  tabs: Tab[];
  activeProcessTabId: string | null;
  activeDocTabId: string | null;
  docHost: HTMLElement | null;
  allBuckets: Record<string, TabsBucketLike>;
  activeProjectKey: string;
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
  onOpenFolder: () => void;
  onCloneFromGithub: () => void;
  onOpenPreviewFile: () => void;
  project: Project | null;
}

export function WorkArea({
  tabs,
  activeProcessTabId,
  activeDocTabId,
  docHost,
  allBuckets,
  activeProjectKey,
  onNewTerminal,
  onLaunchCli,
  onOpenFolder,
  onCloneFromGithub,
  onOpenPreviewFile,
  project,
}: WorkAreaProps) {
  const hasAgent = tabs.some(isProcessTab);

  return (
    <section className="relative flex h-full w-full flex-col overflow-hidden bg-canvas">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <TabContent
          allBuckets={allBuckets}
          activeProjectKey={activeProjectKey}
          activeProcessTabId={activeProcessTabId}
          activeDocTabId={activeDocTabId}
          docHost={docHost}
        />
        {!hasAgent ? (
          <div className="absolute inset-0">
            {project ? (
              <ProjectEmptyState
                project={project}
                onNewTerminal={onNewTerminal}
                onLaunchCli={onLaunchCli}
              />
            ) : (
              <WelcomeScreen
                onOpenFolder={onOpenFolder}
                onCloneFromGithub={onCloneFromGithub}
                onOpenTerminal={onNewTerminal}
                onOpenPreviewFile={onOpenPreviewFile}
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
