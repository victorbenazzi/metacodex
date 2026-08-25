import { CMD, invoke } from "@/lib/ipc";

export interface SerializedTab {
  id: string;
  kind: "editor" | "markdown" | "image" | "pdf";
  title: string;
  path?: string;
  mode?: "preview" | "source";
}

export interface WorkspaceState {
  openTabs: SerializedTab[];
  activeTabId: string | null;
  expandedPaths: string[];
}

export interface WorkspaceSnapshot extends WorkspaceState {
  revision: number;
}

export type WorkspaceSaveResult =
  | { status: "accepted"; revision: number }
  | { status: "stale"; acceptedRevision: number };

export const workspaceApi = {
  save(projectId: string, revision: number, state: WorkspaceState): Promise<WorkspaceSaveResult> {
    return invoke<WorkspaceSaveResult>(CMD.saveWorkspaceState, { projectId, revision, state });
  },
  async load(projectId: string): Promise<WorkspaceSnapshot | null> {
    return (await invoke<WorkspaceSnapshot | null>(CMD.loadWorkspaceState, { projectId })) ?? null;
  },
};
