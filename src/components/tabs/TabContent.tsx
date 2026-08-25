import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { TerminalTab } from "@/components/terminal/TerminalTab";
import { CliTabComponent } from "@/components/terminal/CliTabComponent";
import { EditorTab } from "@/components/editor/EditorTab";
import { DiffTab } from "@/components/editor/DiffTab";
import { MarkdownPreview } from "@/components/previews/MarkdownPreview";
import { ImagePreview } from "@/components/previews/ImagePreview";
import { PdfPreview } from "@/components/previews/PdfPreview";
import { isProcessTab, isWorkbenchDocTab } from "@/features/tabs";
import type { Tab } from "./types";

interface TabsBucketLike {
  tabs: Tab[];
  activeTabId: string | null;
}

interface TabContentProps {
  /**
   * Every project's tab bucket. We render tabs from ALL projects so that
   * PTYs/xterm sessions and CodeMirror buffers survive switching the active
   * project. Only the focused process (center) or document (right panel) is
   * shown; everything else stays mounted with display:none.
   */
  allBuckets: Record<string, TabsBucketLike>;
  activeProjectKey: string;
  /** Process tab shown in the center column. */
  activeProcessTabId: string | null;
  /** Document tab shown in the right workbench, when focus is "doc". */
  activeDocTabId: string | null;
  /** Mount point for file/diff/preview tabs. When null they stay hidden here. */
  docHost: HTMLElement | null;
}

function renderTab(tab: Tab, isVisible: boolean, projectKey: string) {
  const preview = tab.projectId == null;
  switch (tab.kind) {
    case "terminal":
      return (
        <TerminalTab
          tabId={tab.id}
          cwd={tab.cwd}
          projectId={tab.projectId}
          label={tab.title}
          prefillCommand={tab.prefillCommand}
          isVisible={isVisible}
        />
      );
    case "cli":
      return (
        <CliTabComponent
          tabId={tab.id}
          cwd={tab.cwd}
          projectId={tab.projectId}
          label={tab.title}
          cliId={tab.cliId}
          launchCommand={tab.launchCommand}
          launchArgs={tab.launchArgs}
          isVisible={isVisible}
        />
      );
    case "editor":
      return (
        <EditorTab
          tabId={tab.id}
          path={tab.path}
          projectId={tab.projectId ?? ""}
          projectKey={projectKey}
          preview={preview}
          previewGrantId={tab.previewGrantId}
        />
      );
    case "diff":
      return (
        <DiffTab
          path={tab.path}
          projectId={tab.projectId ?? ""}
          status={tab.status}
        />
      );
    case "markdown":
      return (
        <MarkdownPreview
          tabId={tab.id}
          path={tab.path}
          projectId={tab.projectId ?? ""}
          projectKey={projectKey}
          mode={tab.mode}
          preview={preview}
          previewGrantId={tab.previewGrantId}
        />
      );
    case "image":
      return <ImagePreview path={tab.path} preview={preview} previewGrantId={tab.previewGrantId} />;
    case "pdf":
      return <PdfPreview path={tab.path} preview={preview} previewGrantId={tab.previewGrantId} />;
    default:
      return null;
  }
}

function TabMount({
  tab,
  isVisible,
  projectKey,
}: {
  tab: Tab;
  isVisible: boolean;
  projectKey: string;
}) {
  return (
    <div
      style={{ display: isVisible ? "block" : "none" }}
      className="h-full w-full"
    >
      {renderTab(tab, isVisible, projectKey)}
    </div>
  );
}

/**
 * Render-all-hide-inactive: every tab across EVERY project stays mounted with
 * `display: none` so xterm/PTY sessions and CodeMirror state survive both tab
 * switches AND project switches. Process tabs paint in the center column;
 * document tabs portal into the right workbench host.
 */
export function TabContent({
  allBuckets,
  activeProjectKey,
  activeProcessTabId,
  activeDocTabId,
  docHost,
}: TabContentProps) {
  const processNodes: ReactNode[] = [];
  const docNodes: ReactNode[] = [];

  for (const [projectKey, bucket] of Object.entries(allBuckets)) {
    for (const tab of bucket.tabs) {
      const inActiveProject = projectKey === activeProjectKey;
      if (isProcessTab(tab)) {
        processNodes.push(
          <TabMount
            key={`${projectKey}::${tab.id}`}
            tab={tab}
            isVisible={inActiveProject && tab.id === activeProcessTabId}
            projectKey={projectKey}
          />,
        );
      } else if (isWorkbenchDocTab(tab)) {
        docNodes.push(
          <TabMount
            key={`${projectKey}::${tab.id}`}
            tab={tab}
            isVisible={inActiveProject && tab.id === activeDocTabId}
            projectKey={projectKey}
          />,
        );
      }
    }
  }

  return (
    <>
      <div className="relative h-full w-full overflow-hidden bg-canvas">
        {processNodes}
      </div>
      {docHost
        ? createPortal(<>{docNodes}</>, docHost)
        : (
          <div className="hidden" aria-hidden>
            {docNodes}
          </div>
        )}
    </>
  );
}
