import type { Tab } from "./types";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";
import { NewTabContextMenu } from "./NewTabMenu";
import { TabTrailingActions } from "./TabTrailingActions";
import { WelcomeScreen } from "@/app/WelcomeScreen";
import { ProjectEmptyState } from "@/app/ProjectEmptyState";
import type { CliTool } from "@/features/terminal/cli-registry";
import type { Project } from "@/features/projects/project.types";

interface TabsBucketLike {
  tabs: Tab[];
  activeTabId: string | null;
}

interface WorkAreaProps {
  /** Active project's tabs — drives the TabBar and the empty-state decision. */
  tabs: Tab[];
  activeTabId: string | null;
  /**
   * All projects' tab buckets. TabContent mounts EVERY tab across EVERY project
   * (hidden via display:none when not active) so PTY sessions and editor
   * buffers survive switching projects.
   */
  allBuckets: Record<string, TabsBucketLike>;
  activeProjectKey: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOthers: (keepId: string) => void;
  onCloseAll: () => void;
  onCopyTabPath: (id: string) => void;
  onRevealTabInFinder: (id: string) => void;
  onCopyTabCwd: (id: string) => void;
  onRenameTab: (id: string, newTitle: string) => void;
  onMoveTab: (id: string, toIndex: number) => void;
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
  onNewWorktree?: () => void;
  onOpenFolder: () => void;
  onCloneFromGithub: () => void;
  project: Project | null;
}

export function WorkArea({
  tabs,
  activeTabId,
  allBuckets,
  activeProjectKey,
  onSelectTab,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onCopyTabPath,
  onRevealTabInFinder,
  onCopyTabCwd,
  onRenameTab,
  onMoveTab,
  onNewTerminal,
  onLaunchCli,
  onNewWorktree,
  onOpenFolder,
  onCloneFromGithub,
  project,
}: WorkAreaProps) {
  // TabContent always lives at the same JSX position regardless of whether the
  // active project has tabs — otherwise React would unmount the whole tab tree
  // (and kill the PTYs/editors of OTHER projects mounted underneath) every time
  // the user lands on a project with an empty bucket.
  const hasActiveTabs = tabs.length > 0;

  return (
    <section className="relative flex h-full w-full flex-col overflow-hidden bg-canvas">
      {hasActiveTabs ? (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={onSelectTab}
          onClose={onCloseTab}
          onCloseOthers={onCloseOthers}
          onCloseAll={onCloseAll}
          onCopyTabPath={onCopyTabPath}
          onRevealTabInFinder={onRevealTabInFinder}
          onCopyTabCwd={onCopyTabCwd}
          onRenameTab={onRenameTab}
          onMoveTab={onMoveTab}
          onNewTerminal={onNewTerminal}
          onLaunchCli={onLaunchCli}
          trailing={
            <TabTrailingActions
              onNewTerminal={onNewTerminal}
              onLaunchCli={onLaunchCli}
              onNewWorktree={onNewWorktree}
            />
          }
        />
      ) : (
        <NewTabContextMenu onNewTerminal={onNewTerminal} onLaunchCli={onLaunchCli}>
          <div
            data-tauri-drag-region
            className="flex h-[34px] shrink-0 items-center justify-end border-b border-hairline px-[10px]"
          >
            <TabTrailingActions
              onNewTerminal={onNewTerminal}
              onLaunchCli={onLaunchCli}
              onNewWorktree={onNewWorktree}
            />
          </div>
        </NewTabContextMenu>
      )}
      <div className="relative flex-1 overflow-hidden">
        <TabContent
          allBuckets={allBuckets}
          activeProjectKey={activeProjectKey}
          activeTabId={activeTabId}
        />
        {!hasActiveTabs ? (
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
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
