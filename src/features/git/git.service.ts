import { CMD, invoke } from "@/lib/ipc";
import type { GitInfo } from "./git.types";

export const gitApi = {
  status(root: string): Promise<GitInfo | null> {
    return invoke<GitInfo | null>(CMD.gitStatus, { root });
  },
};
