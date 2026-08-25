import type { Tab } from "@/components/tabs/types";
import { useTabsStore, WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import type { Project } from "@/features/projects/project.types";
import { useProjectsStore } from "@/features/projects/project.store";
import { useExplorerStore } from "@/features/explorer/explorer.store";
import type { CliTool } from "@/features/terminal/cli-registry";
import { sessionController } from "@/features/terminal/sessionController";
import type { PreviewGrant } from "@/lib/events";
import { basename } from "@/lib/path";
import { useSidePanelStore } from "@/features/side-panel/sidePanel.store";
import type { ResumeEntry } from "@/features/resume/resume.service";
import { buildResumeTab, isLiveResumeSession } from "@/features/resume/resumeLaunch";
import {
  makeCliTab,
  makeDiffTab,
  makeFileTab,
  makePreviewTab,
  makeTerminalTab,
  isProcessTab,
} from "./factories";
import { planClose, planCloseTab, type ClosePlan, type PendingClose } from "./closePolicy";
import { usePendingCloseStore } from "./pendingClose.store";

function openTabInProject(projectKey: string, tab: Tab, setActive = true): void {
  useTabsStore.getState().openTab(projectKey, tab, setActive);
}

function tabsFor(projectKey: string): Tab[] {
  return useTabsStore.getState().byProject[projectKey]?.tabs ?? [];
}

function focusWorkbenchDoc(id: string): void {
  useSidePanelStore.getState().focusDoc(id);
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

/**
 * Kill Process tabs (parallel, via Session controller), then drop store rows.
 * Unmount stop is idempotent; explicit stop here is the close-path owner so
 * confirm does not rely on React unmount ordering alone.
 */
export async function executeClose(projectKey: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tabs = tabsFor(projectKey);
  const processIds = ids.filter((id) => {
    const tab = tabs.find((t) => t.id === id);
    return tab != null && isProcessTab(tab);
  });
  await Promise.all(processIds.map((id) => sessionController.stop(id)));
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

/** Looks up the live bucket; callers only pass projectKey + tabId. */
export function requestCloseTab(projectKey: string, tabId: string): void {
  applyClosePlan(planCloseTab(projectKey, tabsFor(projectKey), tabId));
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

export function focusProcessTab(projectKey: string, tabId: string): void {
  useTabsStore.getState().setActiveTab(projectKey, tabId);
  useSidePanelStore.getState().setShellFocus("center");
}

// --- Open helpers (factory + store; call sites stay one-liners) --------------

export function openTerminal(args: {
  projectKey: string;
  projectId: string | null;
  cwd: string;
  title: string;
  prefillCommand?: string;
}): void {
  openTabInProject(args.projectKey, makeTerminalTab(args));
  useSidePanelStore.getState().setShellFocus("center");
}

export function openCli(args: {
  projectKey: string;
  projectId: string | null;
  cwd: string;
  cli: CliTool;
  title?: string;
  elevated?: boolean;
}): void {
  openTabInProject(args.projectKey, makeCliTab(args));
  useSidePanelStore.getState().setShellFocus("center");
}

export function openResume(entry: ResumeEntry): void {
  const tabs = useTabsStore.getState();
  for (const [projectKey, bucket] of Object.entries(tabs.byProject)) {
    const live = bucket.tabs.find((candidate) => isLiveResumeSession(candidate, entry));
    if (!live) continue;
    if (projectKey !== WORKSPACE_NULL) {
      void useProjectsStore.getState().setActive(projectKey);
    }
    tabs.setActiveTab(projectKey, live.id);
    useSidePanelStore.getState().setShellFocus("center");
    return;
  }
  const tab = buildResumeTab(entry);
  if (!tab) return;
  const key = entry.projectId ?? WORKSPACE_NULL;
  openTabInProject(key, tab);
  useSidePanelStore.getState().setShellFocus("center");
}

export function openFileInProject(
  project: Project,
  path: string,
  name: string,
  openInEditMode?: boolean,
): string {
  const tab = makeFileTab({ projectId: project.id, path, name, openInEditMode });
  openTabInProject(project.id, tab, false);
  focusWorkbenchDoc(tab.id);
  return tab.id;
}

export function openPreview(projectKey: string, grant: PreviewGrant): string {
  const tab = makePreviewTab({ path: grant.path, grantId: grant.grantId });
  openTabInProject(projectKey, tab, false);
  focusWorkbenchDoc(tab.id);
  return tab.id;
}

export function openDiffInProject(args: {
  project: Project;
  path: string;
  status: string;
}): string {
  const tab = makeDiffTab({
    projectId: args.project.id,
    path: args.path,
    status: args.status,
  });
  openTabInProject(args.project.id, tab, false);
  focusWorkbenchDoc(tab.id);
  return tab.id;
}

export function openAfterSentToProject(args: {
  dest: Project;
  oldPath: string;
  newPath: string;
  toDir: string;
}): string {
  const previewId = `pf-${args.oldPath}`;
  const buckets = useTabsStore.getState().byProject;
  for (const [key, b] of Object.entries(buckets)) {
    if (b.tabs.some((tb) => tb.id === previewId)) {
      useTabsStore.getState().closeTab(key, previewId);
    }
  }
  const tab = makeFileTab({
    projectId: args.dest.id,
    path: args.newPath,
    name: basename(args.newPath),
  });
  openTabInProject(args.dest.id, tab, false);
  void useProjectsStore.getState().setActive(args.dest.id);
  void useExplorerStore.getState().refresh(args.dest.id, args.toDir);
  focusWorkbenchDoc(tab.id);
  return tab.id;
}
