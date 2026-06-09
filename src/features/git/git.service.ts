import { CMD, invoke } from "@/lib/ipc";
import type { GitInfo } from "./git.types";

export interface BranchInfo {
  name: string;
  current: boolean;
}

export const gitApi = {
  status(root: string): Promise<GitInfo | null> {
    return invoke<GitInfo | null>(CMD.gitStatus, { root });
  },
  /** Committed (HEAD) text of a file, or null when untracked / no commits. */
  fileHeadContent(path: string): Promise<string | null> {
    return invoke<string | null>(CMD.gitFileHeadContent, { path });
  },
  /** Local branches, most-recently-committed first; current one flagged. */
  branchList(root: string): Promise<BranchInfo[]> {
    return invoke<BranchInfo[]>(CMD.gitBranchList, { root });
  },
  /** Switch the working tree to an existing local branch. */
  checkout(root: string, branch: string): Promise<void> {
    return invoke<void>(CMD.gitCheckout, { root, branch });
  },
  /** Create a branch off HEAD and switch to it. */
  createBranch(root: string, name: string): Promise<void> {
    return invoke<void>(CMD.gitCreateBranch, { root, name });
  },
};
