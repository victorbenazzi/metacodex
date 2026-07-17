import { watcherApi } from "@/features/filesystem/watcher.service";
import { useExplorerStore } from "@/features/explorer/explorer.store";
import { useGitStore } from "@/features/git/git.store";
import { useWorktreesStore } from "@/features/git/worktrees.store";

/**
 * Manual "sync now" for a project (the explorer header button). The watcher
 * keeps the tree fresh on its own; this is the user-facing escape hatch for
 * the cases events can't cover: changes made while the app was closed, a
 * watcher that failed to start, or an FSEvents overflow that got coalesced.
 *
 * Re-asserts the watch (idempotent when already wired, so it only repairs a
 * watch that never started), re-reads the root plus every cached directory
 * listing, and refreshes git status and worktrees.
 */
export async function syncProjectNow(
  projectId: string,
  rootPath: string,
): Promise<void> {
  const explorer = useExplorerStore.getState();
  await Promise.all([
    watcherApi.watch(projectId, rootPath).catch((err) => {
      console.warn("[sync] watch failed", err);
    }),
    explorer
      .loadIfNeeded(projectId, rootPath)
      .then(() => explorer.refreshAll(projectId)),
    Promise.resolve(useGitStore.getState().refresh(projectId, rootPath)).catch(
      (err) => console.warn("[sync] git refresh failed", err),
    ),
    Promise.resolve(
      useWorktreesStore.getState().refresh(projectId, rootPath),
    ).catch((err) => console.warn("[sync] worktrees refresh failed", err)),
  ]);
}
