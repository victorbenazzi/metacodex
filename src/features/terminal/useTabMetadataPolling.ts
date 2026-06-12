import { useEffect } from "react";

import { CMD, invoke } from "@/lib/ipc";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { useProjectsStore } from "@/features/projects/project.store";
import {
  useTabMetadataStore,
  type PtyMetadata,
} from "@/features/terminal/tabMetadata.store";

/**
 * Single polling loop that refreshes branch/cwd/ports for every running PTY
 * session in one batch IPC call. Mount once in AppShell.
 *
 * - Tick every `intervalMs` (default 3000).
 * - Pause while `document.hidden` — saves cycles + macOS battery when the user
 *   is in another app.
 * - Re-arms when the visible PTY set changes (sessions added/removed).
 *
 * Only polls sessions in the ACTIVE project: the TabTooltip only ever consumes
 * those, and background-project sessions would otherwise each cost an lsof/git
 * probe every tick for data nothing reads.
 */
export function useTabMetadataPolling(intervalMs = 3000) {
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const sessionIdsKey = useTerminalStore((s) =>
    Object.values(s.sessions)
      .filter((sess) => sess.status === "running" && sess.projectId === activeProjectId)
      .map((sess) => sess.id)
      .sort()
      .join(","),
  );

  useEffect(() => {
    const ids = sessionIdsKey ? sessionIdsKey.split(",") : [];
    if (ids.length === 0) return;

    const tick = async () => {
      if (document.hidden) return;
      try {
        const batch = await invoke<PtyMetadata[]>(CMD.ptyMetadataBatch, {
          sessionIds: ids,
        });
        useTabMetadataStore.getState().setBatch(batch);
      } catch (err) {
        console.warn("[pty_metadata_batch] failed", err);
      }
    };

    void tick();
    const handle = window.setInterval(tick, intervalMs);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(handle);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sessionIdsKey, intervalMs]);
}
