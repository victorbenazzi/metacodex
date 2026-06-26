import { TerminalTab } from "@/components/terminal/TerminalTab";
import { CliTabComponent } from "@/components/terminal/CliTabComponent";
import { EditorTab } from "@/components/editor/EditorTab";
import { DiffTab } from "@/components/editor/DiffTab";
import { MarkdownPreview } from "@/components/previews/MarkdownPreview";
import { ImagePreview } from "@/components/previews/ImagePreview";
import { PdfPreview } from "@/components/previews/PdfPreview";
import type { Tab } from "./types";

interface TabsBucketLike {
  tabs: Tab[];
  activeTabId: string | null;
}

interface TabContentProps {
  /**
   * Every project's tab bucket. We render tabs from ALL projects so that
   * PTYs/xterm sessions and CodeMirror buffers survive switching the active
   * project , only the active project's active tab is shown; everything else
   * stays mounted with display:none.
   */
  allBuckets: Record<string, TabsBucketLike>;
  activeProjectKey: string;
  activeTabId: string | null;
}

function renderTab(tab: Tab, isVisible: boolean, projectKey: string) {
  // Invariant: a file tab with `projectId === null` is a preview tab (opened
  // outside any project). Renderers branch on this to read/write via the
  // roots-bypassing preview commands and to skip project-only features (git).
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

/**
 * Render-all-hide-inactive: every tab across EVERY project stays mounted with
 * `display: none` so xterm/PTY sessions and CodeMirror state survive both tab
 * switches AND project switches. The whole point of metacodex is multi-project
 * orchestration , an AI agent running in project A must keep working when the
 * user jumps to project B and back.
 */
export function TabContent({ allBuckets, activeProjectKey, activeTabId }: TabContentProps) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      {Object.entries(allBuckets).flatMap(([projectKey, bucket]) =>
        bucket.tabs.map((tab) => {
          const isVisible =
            projectKey === activeProjectKey && tab.id === activeTabId;
          return (
            <div
              key={`${projectKey}::${tab.id}`}
              style={{ display: isVisible ? "block" : "none" }}
              className="h-full w-full"
            >
              {renderTab(tab, isVisible, projectKey)}
            </div>
          );
        }),
      )}
    </div>
  );
}
