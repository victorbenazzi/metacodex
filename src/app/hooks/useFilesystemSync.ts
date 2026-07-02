import { useEffect } from "react";

import type { Project } from "@/features/projects/project.types";
import { watcherApi } from "@/features/filesystem/watcher.service";
import { useExplorerStore } from "@/features/explorer/explorer.store";
import { useGitStore } from "@/features/git/git.store";
import { useWorktreesStore } from "@/features/git/worktrees.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { useTabsStore } from "@/components/tabs/tabsStore";
import { EV, listenTo, type FsChangedPayload, type FsRenamedPayload } from "@/lib/events";
import { dirname } from "@/lib/path";
import { CMD, invoke } from "@/lib/ipc";
import { recordDiag } from "@/features/diagnostics/diagnostics.store";

export function useFilesystemSync(project: Project | null): void {
  const refreshGit = useGitStore((s) => s.refresh);

  useEffect(() => {
    if (!project) return;
    void watcherApi.watch(project.id, project.path).catch((err) => {
      console.warn("[watcher] watch failed", err);
    });
    return () => {
      void watcherApi.unwatch(project.id).catch(() => undefined);
    };
  }, [project]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let unlistenRenamed: (() => void) | undefined;
    const gitThrottleLast = new Map<string, number>();
    const gitThrottleTimer = new Map<string, ReturnType<typeof setTimeout>>();
    const GIT_THROTTLE_MS = 400;
    const scheduleGitRefresh = (pid: string, root: string) => {
      const run = () => {
        gitThrottleLast.set(pid, Date.now());
        void useGitStore.getState().refresh(pid, root);
      };
      const since = Date.now() - (gitThrottleLast.get(pid) ?? 0);
      if (since >= GIT_THROTTLE_MS) {
        run();
      } else if (!gitThrottleTimer.has(pid)) {
        const tm = setTimeout(() => {
          gitThrottleTimer.delete(pid);
          run();
        }, GIT_THROTTLE_MS - since);
        gitThrottleTimer.set(pid, tm);
      }
    };
    (async () => {
      const off = await listenTo<FsChangedPayload>(EV.fsChanged, async (e) => {
        const { projectId, paths } = e.payload;
        const explorer = useExplorerStore.getState();
        const bucket = explorer.byProject[projectId];
        if (bucket) {
          const cachedDirs = Object.keys(bucket.children);
          const toRefresh = new Set<string>();
          for (const p of paths) {
            toRefresh.add(dirname(p));
            toRefresh.add(p);
            for (const d of cachedDirs) {
              if (d.startsWith(p + "/")) toRefresh.add(d);
            }
          }
          for (const d of toRefresh) {
            if (bucket.children[d]) void explorer.refresh(projectId, d);
          }
        }
        const proj = useProjectsStore
          .getState()
          .projects.find((p) => p.id === projectId);
        if (proj) {
          scheduleGitRefresh(projectId, proj.path);
        }
        const bucket2 = useTabsStore.getState().byProject[projectId];
        if (bucket2) {
          const openFilePaths = new Set<string>();
          for (const t of bucket2.tabs) {
            if ("path" in t && (t as { path?: string }).path) {
              openFilePaths.add((t as { path: string }).path);
            }
          }
          const candidates = paths.filter(
            (p) =>
              openFilePaths.has(p) ||
              [...openFilePaths].some((open) => open.startsWith(p + "/")),
          );
          for (const p of candidates) {
            try {
              await invoke(CMD.stat, { path: p });
            } catch {
              useTabsStore.getState().closeForRemovedPath(projectId, p);
              recordDiag("tab.close_external", { projectId, detail: { path: p } });
            }
          }
        }
      });
      const offRen = await listenTo<FsRenamedPayload>(EV.fsRenamed, (e) => {
        const { projectId, oldPath, newPath } = e.payload;
        useTabsStore.getState().remapForRename(projectId, oldPath, newPath);
        recordDiag("fs.renamed", { projectId, detail: { oldPath, newPath } });
      });
      unlisten = off;
      unlistenRenamed = offRen;
    })();
    return () => {
      for (const tm of gitThrottleTimer.values()) clearTimeout(tm);
      unlisten?.();
      unlistenRenamed?.();
    };
  }, []);

  useEffect(() => {
    if (!project) return;
    void refreshGit(project.id, project.path);
    void useWorktreesStore.getState().refresh(project.id, project.path);
  }, [project, refreshGit]);
}
