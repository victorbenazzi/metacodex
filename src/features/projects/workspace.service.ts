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

export const workspaceApi = {
  save(projectId: string, state: WorkspaceState): Promise<void> {
    return invoke<void>(CMD.saveWorkspaceState, { projectId, state });
  },
  async load(projectId: string): Promise<WorkspaceState | null> {
    return (await invoke<WorkspaceState | null>(CMD.loadWorkspaceState, { projectId })) ?? null;
  },
};
