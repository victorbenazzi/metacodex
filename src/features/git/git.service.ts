import { CMD, invoke } from "@/lib/ipc";
import type { GitInfo } from "./git.types";

export const gitApi = {
  status(root: string): Promise<GitInfo | null> {
    return invoke<GitInfo | null>(CMD.gitStatus, { root });
  },
  /** Committed (HEAD) text of a file, or null when untracked / no commits. */
  fileHeadContent(path: string): Promise<string | null> {
    return invoke<string | null>(CMD.gitFileHeadContent, { path });
  },
};
