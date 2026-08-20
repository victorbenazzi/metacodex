export {
  makeTerminalTab,
  makeCliTab,
  makeFileTab,
  makePreviewTab,
  makePathTab,
  makeDiffTab,
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
  openResume,
  openFileInProject,
  openPreview,
  openDiffInProject,
  openAfterSentToProject,
  focusProcessTab,
} from "./tabLifecycle";
