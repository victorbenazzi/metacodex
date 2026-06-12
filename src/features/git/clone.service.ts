import { CMD, invoke } from "@/lib/ipc";
import { EV, listenTo, type GitCloneProgressPayload } from "@/lib/events";
import { newId } from "@/lib/idGen";

export interface CloneRepoArgs {
  url: string;
  parentDir: string;
  folderName: string;
  /** Pass to make the clone cancellable via `cancelClone(opId)`. Generated if omitted. */
  opId?: string;
  onProgress?: (p: { phase: string; percent: number }) => void;
}

/** Abort an in-flight clone by op id. The pending `cloneRepo` promise rejects. */
export async function cancelClone(opId: string): Promise<void> {
  await invoke<void>(CMD.gitCloneCancel, { opId });
}

/**
 * Clone a git repository. Returns the absolute path of the freshly-created
 * checkout on success. Throws an AppError on failure (URL invalid, destination
 * already exists, network/auth failure, etc.). Progress updates are streamed
 * via the `onProgress` callback while the clone is in flight.
 */
export async function cloneRepo({
  url,
  parentDir,
  folderName,
  opId: opIdArg,
  onProgress,
}: CloneRepoArgs): Promise<string> {
  const opId = opIdArg ?? `clone-${newId(10)}`;
  let unlisten: (() => void) | undefined;
  if (onProgress) {
    unlisten = await listenTo<GitCloneProgressPayload>(EV.gitCloneProgress, (e) => {
      if (e.payload.opId !== opId) return;
      onProgress({ phase: e.payload.phase, percent: e.payload.percent });
    });
  }
  try {
    return await invoke<string>(CMD.gitClone, {
      opId,
      url,
      parentDir,
      folderName,
    });
  } finally {
    unlisten?.();
  }
}

/**
 * Best-effort parser for a git URL → repo name. Handles HTTPS, SSH (git@host:owner/repo),
 * and trailing `.git`. Returns an empty string for anything that doesn't look
 * URL-shaped, letting the caller fall back to a blank folder-name field.
 */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  // Strip a trailing slash and ".git" suffix.
  const noTrailing = trimmed.replace(/\/+$/, "");
  const noDotGit = noTrailing.replace(/\.git$/i, "");
  // SSH form: git@host:owner/repo
  const sshMatch = noDotGit.match(/[:/]([A-Za-z0-9._-]+)$/);
  if (sshMatch) return sshMatch[1];
  return "";
}
