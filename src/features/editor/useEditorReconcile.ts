import { useEffect } from "react";

import { EV, listenTo, type FsChangedPayload } from "@/lib/events";
import { fsApi } from "@/features/filesystem/filesystem.service";
import { useTabsStore } from "@/components/tabs/tabsStore";
import { useEditorStore } from "./editor.store";

/** Match the read limit EditorTab uses so we compare like-for-like content. */
const READ_LIMIT = 25 * 1024 * 1024;

/**
 * Watches `fs://changed` and reconciles open editor buffers with disk.
 *
 * metacodex wraps the user's terminal: AI agents (Claude Code, Codex, …) run in
 * PTY tabs and edit files directly on disk. Without reconciliation an open
 * buffer silently diverges, and a `Cmd+S` would clobber the agent's work.
 *
 * Strategy , no Rust, no mtime. Compare fresh disk content against the buffer's
 * known baseline (`editor.store` `loadedContent`):
 *   - equal           → our own atomic-write echo or a no-op; ignore.
 *   - differ & clean  → reload the buffer silently.
 *   - differ & dirty  → surface a conflict banner (Recarregar / Manter o meu).
 *   - read fails      → file removed/renamed on disk; surface a "removed" banner.
 *
 * Works for buffers in background tabs too (they stay mounted under the
 * render-all-hide-inactive pattern), which is exactly when an agent is most
 * likely to touch a file you're not currently looking at.
 */
export function useEditorReconcile() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      const off = await listenTo<FsChangedPayload>(EV.fsChanged, (e) => {
        void reconcile(e.payload.paths);
      });
      if (disposed) off();
      else unlisten = off;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

async function reconcile(changedPaths: string[]) {
  if (changedPaths.length === 0) return;
  const editor = useEditorStore.getState();
  const { byProject } = useTabsStore.getState();

  // Collect (tabId → path) for every open file-backed tab that has a live editor
  // buffer and whose path is touched by an event path. Dedupe by tabId.
  const targets = new Map<string, string>();
  for (const bucket of Object.values(byProject)) {
    for (const tab of bucket.tabs) {
      if (!("path" in tab) || !tab.path) continue;
      if (!matchesChangedPath(tab.path, changedPaths)) continue;
      if (!editor.get(tab.id)) continue; // no live buffer (e.g. markdown in preview)
      targets.set(tab.id, tab.path);
    }
  }
  if (targets.size === 0) return;

  for (const [tabId, path] of targets) {
    const st = useEditorStore.getState().get(tabId);
    if (!st) continue;
    // Skip mid-save: the atomic write itself fires the watcher for this path.
    if (st.saving) continue;
    try {
      const disk = await fsApi.readFileText(path, READ_LIMIT);
      const cur = useEditorStore.getState().get(tabId);
      if (!cur || cur.saving) continue;
      if (disk.content === cur.loadedContent) continue; // no real divergence
      if (cur.dirty) {
        useEditorStore.getState().flagExternalChange(tabId, disk.content);
      } else {
        useEditorStore.getState().requestReload(tabId, disk.content);
      }
    } catch {
      const cur = useEditorStore.getState().get(tabId);
      if (cur) useEditorStore.getState().flagExternalDelete(tabId);
    }
  }
}

function matchesChangedPath(filePath: string, changedPaths: string[]): boolean {
  for (const changedPath of changedPaths) {
    if (filePath === changedPath) return true;
    if (filePath.startsWith(changedPath + "/")) return true;
    if (filePath.startsWith(changedPath + "\\")) return true;
  }
  return false;
}
