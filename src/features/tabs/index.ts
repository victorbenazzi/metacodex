export {
  makeTerminalTab,
  makeCliTab,
  makeFileTab,
  makePreviewTab,
  makePathTab,
  makeDiffTab,
  makeChangesTab,
  isProcessTab,
  isWorkbenchDocTab,
} from "./factories";

export {
  planClose,
  planCloseTab,
  processSummary,
  type ClosePlan,
  type PendingClose,
} from "./closePolicy";

export { usePendingCloseStore } from "./pendingClose.store";

export {
  applyClosePlan,
  executeClose,
  requestCloseTabs,
  requestCloseTab,
  confirmPendingClose,
  cancelPendingClose,
  openTerminal,
  openCli,
  openFileInProject,
  openPreview,
  openDiffInProject,
  openChangesInProject,
  openAfterSentToProject,
} from "./tabLifecycle";
