import { CMD, invoke } from "@/lib/ipc";

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string | null;
  isMain: boolean;
  locked: boolean;
  prunable: boolean;
}

export type MergeStrategy = "ff-only" | "merge" | "squash";

export const worktreesApi = {
  list(root: string): Promise<WorktreeInfo[]> {
    return invoke<WorktreeInfo[]>(CMD.gitWorktreeList, { root });
  },
  add(
    root: string,
    branchName: string,
    options?: { targetPath?: string; baseRef?: string },
  ): Promise<WorktreeInfo> {
    return invoke<WorktreeInfo>(CMD.gitWorktreeAdd, {
      root,
      branchName,
      targetPath: options?.targetPath ?? null,
      baseRef: options?.baseRef ?? null,
    });
  },
  remove(root: string, worktreePath: string, force = false): Promise<void> {
    return invoke<void>(CMD.gitWorktreeRemove, {
      root,
      worktreePath,
      force,
    });
  },
  merge(root: string, branch: string, strategy: MergeStrategy): Promise<void> {
    return invoke<void>(CMD.gitMergeInto, { root, branch, strategy });
  },
};
