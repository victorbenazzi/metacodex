import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/ui/EmptyState";
import { ExplorerPanel } from "@/components/file-explorer/ExplorerPanel";
import { BrowserPanel } from "@/components/browser/BrowserPanel";
import { ChangesView } from "@/components/source-control/ChangesView";
import { WorkbenchTabBar } from "@/components/v3-shell/WorkbenchTabBar";
import {
  useSidePanelStore,
  type RightWorkbenchTab,
} from "@/features/side-panel/sidePanel.store";
import { isWorkbenchDocTab } from "@/features/tabs";
import type { Tab } from "@/components/tabs/types";
import type { Project } from "@/features/projects/project.types";
import type { CliTool } from "@/features/terminal/cli-registry";
import { cn } from "@/lib/cn";
import { isMac, isWindows } from "@/lib/platform";
import type { WorkbenchLayout } from "@/features/browser/workbenchLayout";

interface RightWorkbenchProps {
  project: Project | null;
  tabs: Tab[];
  activeDocTabId: string | null;
  layout: WorkbenchLayout;
  onSelectDoc: (id: string) => void;
  onCloseDoc: (id: string) => void;
  onMoveDoc: (id: string, toIndex: number) => void;
  onOpenFolder: () => void;
  onOpenFile: (path: string, name: string, openInEditMode?: boolean) => void;
  onOpenInBrowser: (path: string) => void;
  onOpenInTerminal: (path: string, name: string) => void;
  onLaunchCliInPath: (cli: CliTool, path: string, name: string) => void;
  onOpenChanges: (expandPath?: string) => void;
}

export function RightWorkbench({
  project,
  tabs,
  activeDocTabId,
  layout,
  onSelectDoc,
  onCloseDoc,
  onMoveDoc,
  onOpenFolder,
  onOpenFile,
  onOpenInBrowser,
  onOpenInTerminal,
  onLaunchCliInPath,
  onOpenChanges,
}: RightWorkbenchProps) {
  const { t } = useTranslation();
  const view = useSidePanelStore((s) => s.view);
  const openTabs = useSidePanelStore((s) => s.openTabs);
  const show = useSidePanelStore((s) => s.show);
  const closeTab = useSidePanelStore((s) => s.closeTab);
  const moveTab = useSidePanelStore((s) => s.moveTab);
  const surface: RightWorkbenchTab = view === "closed" ? "changes" : view;
  const docs = tabs.filter(isWorkbenchDocTab);
  const showingDoc = activeDocTabId != null;
  const expanded = layout === "browserOverlay";
  const stripActive = showingDoc
    ? `doc:${activeDocTabId}`
    : `surface:${surface}`;

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col bg-canvas",
        !expanded && "border-l border-hairline-soft",
      )}
      aria-label={t("v3.workbench.aria")}
    >
      <header
        data-tauri-drag-region
        className={cn(
          "flex h-[var(--title-bar-h)] shrink-0 items-center border-b border-hairline-soft",
          isMac && expanded ? "pl-[94px]" : null,
          isWindows ? "pr-[176px]" : "pr-42px",
        )}
      >
        <WorkbenchTabBar
          surfaces={openTabs}
          docs={docs}
          activeKey={stripActive}
          onSelectSurface={(id) => {
            show(id);
            if (id === "changes") onOpenChanges();
          }}
          onSelectDoc={onSelectDoc}
          onCloseSurface={closeTab}
          onCloseDoc={onCloseDoc}
          onMoveSurface={moveTab}
          onMoveDoc={(id, toDocIndex) => {
            const target = docs[Math.max(0, Math.min(docs.length - 1, toDocIndex))];
            if (!target) return;
            const toIndex = tabs.findIndex((tab) => tab.id === target.id);
            if (toIndex >= 0) onMoveDoc(id, toIndex);
          }}
          onOpenSurface={show}
        />
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          className="h-full w-full"
          style={{ display: showingDoc || surface !== "changes" ? "none" : "block" }}
        >
          {project ? (
            <ChangesView
              projectId={project.id}
              projectPath={project.path}
              variant="panel"
              onOpenFile={onOpenFile}
              onOpenChanges={onOpenChanges}
              onOpenInTerminal={onOpenInTerminal}
              onLaunchCliInPath={onLaunchCliInPath}
            />
          ) : (
            <EmptyState body={t("sourceControl.noProject")} />
          )}
        </div>

        <div
          className="h-full w-full"
          style={{ display: showingDoc || surface !== "files" ? "none" : "block" }}
        >
          <ExplorerPanel
            framed={false}
            hasProject={!!project}
            projectId={project?.id}
            projectName={project?.name}
            projectPath={project?.path}
            onOpenFolder={onOpenFolder}
            onOpenFile={onOpenFile}
            onOpenInBrowser={onOpenInBrowser}
            onOpenInTerminal={onOpenInTerminal}
            onLaunchCliInPath={onLaunchCliInPath}
          />
        </div>

        <div
          className="h-full w-full"
          style={{ display: showingDoc || surface !== "browser" ? "none" : "block" }}
        >
          <BrowserPanel active={!showingDoc && surface === "browser"} />
        </div>
      </div>
    </aside>
  );
}
