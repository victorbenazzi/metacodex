export {
  makeTerminalTab,
  makeCliTab,
  makeFileTab,
  makePreviewTab,
  makeDiffTab,
  isProcessTab,
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
  openAfterSentToProject,
} from "./tabLifecycle";
