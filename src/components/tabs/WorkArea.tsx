import type { Tab } from "./types";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";
import { NewTabContextMenu, NewTabMenu } from "./NewTabMenu";
import { WelcomeScreen } from "@/app/WelcomeScreen";
import type { CliTool } from "@/features/terminal/cli-registry";

interface WorkAreaProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOthers: (keepId: string) => void;
  onCloseAll: () => void;
  onCopyTabPath: (id: string) => void;
  onRevealTabInFinder: (id: string) => void;
  onCopyTabCwd: (id: string) => void;
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
  onOpenFolder: () => void;
}

export function WorkArea({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onCopyTabPath,
  onRevealTabInFinder,
  onCopyTabCwd,
  onNewTerminal,
  onLaunchCli,
  onOpenFolder,
}: WorkAreaProps) {
  if (tabs.length === 0) {
    return (
      <section className="relative flex h-full w-full flex-col overflow-hidden bg-canvas">
        <NewTabContextMenu onNewTerminal={onNewTerminal} onLaunchCli={onLaunchCli}>
          <div
            data-tauri-drag-region
            className="flex h-[30px] shrink-0 items-center justify-end border-b border-hairline px-[10px]"
          >
            <NewTabMenu onNewTerminal={onNewTerminal} onLaunchCli={onLaunchCli} />
          </div>
        </NewTabContextMenu>
        <div className="flex-1 overflow-hidden">
          <WelcomeScreen onOpenFolder={onOpenFolder} onOpenTerminal={onNewTerminal} />
        </div>
      </section>
    );
  }

  return (
    <section className="relative flex h-full w-full flex-col overflow-hidden bg-canvas">
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
        onNewTerminal={onNewTerminal}
        onLaunchCli={onLaunchCli}
        trailing={<NewTabMenu onNewTerminal={onNewTerminal} onLaunchCli={onLaunchCli} />}
      />
      <div className="flex-1 overflow-hidden">
        <TabContent tabs={tabs} activeTabId={activeTabId} />
      </div>
    </section>
  );
}
