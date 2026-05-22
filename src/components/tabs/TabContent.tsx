import { TerminalTab } from "@/components/terminal/TerminalTab";
import { CliTabComponent } from "@/components/terminal/CliTabComponent";
import { EditorTab } from "@/components/editor/EditorTab";
import { DiffTab } from "@/components/editor/DiffTab";
import { MarkdownPreview } from "@/components/previews/MarkdownPreview";
import { ImagePreview } from "@/components/previews/ImagePreview";
import { PdfPreview } from "@/components/previews/PdfPreview";
import type { Tab } from "./types";

interface TabContentProps {
  tabs: Tab[];
  activeTabId: string | null;
}

function renderTab(tab: Tab) {
  switch (tab.kind) {
    case "terminal":
      return (
        <TerminalTab
          tabId={tab.id}
          cwd={tab.cwd}
          projectId={tab.projectId}
          label={tab.title}
          prefillCommand={tab.prefillCommand}
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
        />
      );
    case "editor":
      return (
        <EditorTab
          tabId={tab.id}
          path={tab.path}
          projectId={tab.projectId ?? ""}
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
          mode={tab.mode}
        />
      );
    case "image":
      return <ImagePreview path={tab.path} />;
    case "pdf":
      return <PdfPreview path={tab.path} />;
    default:
      return null;
  }
}

/**
 * Render-all-hide-inactive: every tab stays mounted with `display: none`
 * so xterm sessions and CodeMirror state survive tab switches.
 */
export function TabContent({ tabs, activeTabId }: TabContentProps) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          style={{ display: tab.id === activeTabId ? "block" : "none" }}
          className="h-full w-full"
        >
          {renderTab(tab)}
        </div>
      ))}
    </div>
  );
}
