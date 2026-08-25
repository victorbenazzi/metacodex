import type { SidePanelView } from "@/features/side-panel/sidePanel.store";

export type WorkbenchLayout = "column" | "browserOverlay";

export function resolveWorkbenchLayout(input: {
  view: SidePanelView;
  browserExpanded: boolean;
  activeDocTabId: string | null;
}): WorkbenchLayout {
  return input.browserExpanded && input.view === "browser" && input.activeDocTabId == null
    ? "browserOverlay"
    : "column";
}
