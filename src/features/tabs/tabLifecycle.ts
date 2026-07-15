import type { Tab } from "@/components/tabs/types";
import { useTabsStore } from "@/components/tabs/tabsStore";
import type { Project } from "@/features/projects/project.types";
import { useProjectsStore } from "@/features/projects/project.store";
import { useExplorerStore } from "@/features/explorer/explorer.store";
import type { CliTool } from "@/features/terminal/cli-registry";
import { sessionController } from "@/features/terminal/sessionController";
import type { PreviewGrant } from "@/lib/events";
import { basename } from "@/lib/path";
import {
  makeCliTab,
  makeDiffTab,
  makeFileTab,
  makePreviewTab,
  makeTerminalTab,
  isProcessTab,
} from "./factories";
import {
  planClose,
  planCloseTab,
  type ClosePlan,
  type PendingClose,
} from "./closePolicy";
import { usePendingCloseStore } from "./pendingClose.store";

function openTabInProject(projectKey: string, tab: Tab, setActive = true): void {
  useTabsStore.getState().openTab(projectKey, tab, setActive);
}

/** Apply a Close plan: either execute immediately or raise the shared confirm. */
export function applyClosePlan(plan: ClosePlan | null): void {
  if (!plan) return;
  if (plan.action === "close") {
    void executeClose(plan.projectKey, plan.ids);
    return;
  }
  usePendingCloseStore.getState().setPending(plan.pending);
}

export async function executeClose(projectKey: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const bucket = useTabsStore.getState().byProject[projectKey];
  const tabs = bucket?.tabs ?? [];
  for (const id of ids) {
    const tab = tabs.find((t) => t.id === id);
    if (tab && isProcessTab(tab)) {
      await sessionController.stop(id);
    }
  }
  useTabsStore.getState().closeMany(projectKey, ids);
}

export function requestCloseTabs(
  projectKey: string,
  mode: PendingClose["mode"],
  targets: Tab[],
  singleTab?: Tab,
): void {
  applyClosePlan(planClose(projectKey, mode, targets, singleTab));
}

export function requestCloseTab(projectKey: string, tabs: Tab[], tabId: string): void {
  applyClosePlan(planCloseTab(projectKey, tabs, tabId));
}

export async function confirmPendingClose(): Promise<void> {
  const pending = usePendingCloseStore.getState().pending;
  if (!pending) return;
  usePendingCloseStore.getState().clear();
  await executeClose(pending.projectKey, pending.ids);
}

export function cancelPendingClose(): void {
  usePendingCloseStore.getState().clear();
}

// --- Open helpers ------------------------------------------------------------

export function openTerminal(args: {
  projectKey: string;
  projectId: string | null;
  cwd: string;
  title: string;
  prefillCommand?: string;
}): void {
  openTabInProject(
    args.projectKey,
    makeTerminalTab({
      projectId: args.projectId,
      cwd: args.cwd,
      title: args.title,
      prefillCommand: args.prefillCommand,
    }),
  );
}

export function openCli(args: {
  projectKey: string;
  projectId: string | null;
  cwd: string;
  cli: CliTool;
  title?: string;
}): void {
  openTabInProject(
    args.projectKey,
    makeCliTab({
      projectId: args.projectId,
      cwd: args.cwd,
      cli: args.cli,
      title: args.title,
    }),
  );
}

export function openFileInProject(
  project: Project,
  path: string,
  name: string,
  openInEditMode?: boolean,
): void {
  openTabInProject(
    project.id,
    makeFileTab({
      projectId: project.id,
      path,
      name,
      openInEditMode,
    }),
  );
}

export function openPreview(projectKey: string, grant: PreviewGrant): void {
  openTabInProject(
    projectKey,
    makePreviewTab({ path: grant.path, grantId: grant.grantId }),
  );
}

export function openDiffInProject(args: {
  project: Project;
  path: string;
  status: string;
}): void {
  openTabInProject(
    args.project.id,
    makeDiffTab({
      projectId: args.project.id,
      path: args.path,
      status: args.status,
    }),
  );
}

export function openAfterSentToProject(args: {
  dest: Project;
  oldPath: string;
  newPath: string;
  toDir: string;
}): void {
  const previewId = `pf-${args.oldPath}`;
  const buckets = useTabsStore.getState().byProject;
  for (const [key, b] of Object.entries(buckets)) {
    if (b.tabs.some((tb) => tb.id === previewId)) {
      useTabsStore.getState().closeTab(key, previewId);
    }
  }
  const name = basename(args.newPath);
  openTabInProject(
    args.dest.id,
    makeFileTab({
      projectId: args.dest.id,
      path: args.newPath,
      name,
    }),
  );
  void useProjectsStore.getState().setActive(args.dest.id);
  void useExplorerStore.getState().refresh(args.dest.id, args.toDir);
}
