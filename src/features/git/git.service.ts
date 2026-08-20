import { CMD, invoke } from "@/lib/ipc";
import type { GitInfo } from "./git.types";

export const gitApi = {
  status(root: string, includeStats = false): Promise<GitInfo | null> {
    return invoke<GitInfo | null>(CMD.gitStatus, { root, includeStats });
  },
  /** Committed (HEAD) text of a file, or null when untracked / no commits. */
  fileHeadContent(path: string): Promise<string | null> {
    return invoke<string | null>(CMD.gitFileHeadContent, { path });
  },
  commit(root: string, message: string, paths: string[]): Promise<void> {
    return invoke<void>(CMD.gitCommit, { root, message, paths });
  },
  discard(root: string, paths: string[]): Promise<void> {
    return invoke<void>(CMD.gitDiscard, { root, paths });
  },
  createBranch(root: string, name: string): Promise<void> {
    return invoke<void>(CMD.gitCreateBranch, { root, name });
  },
  branches(root: string): Promise<string[]> {
    return invoke<string[]>(CMD.gitBranches, { root });
  },
  switchBranch(root: string, branch: string): Promise<void> {
    return invoke<void>(CMD.gitSwitchBranch, { root, branch });
  },
  push(root: string): Promise<void> {
    return invoke<void>(CMD.gitPush, { root });
  },
};
