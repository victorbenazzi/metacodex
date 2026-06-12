/**
 * Tiny registry letting non-editor code flush an editor buffer to disk
 * imperatively. Used by "send to project": a previewed file with unsaved edits
 * must be written before it's moved, or the move would carry the stale on-disk
 * version and silently drop the user's changes.
 *
 * EditorTab registers a saver keyed by its tabId; the saver no-ops when the
 * buffer is clean.
 */
const savers = new Map<string, () => Promise<void>>();

export function registerEditorSaver(tabId: string, fn: () => Promise<void>): () => void {
  savers.set(tabId, fn);
  return () => {
    if (savers.get(tabId) === fn) savers.delete(tabId);
  };
}

/** Flush the editor for `tabId` if one is registered (no-op otherwise). */
export async function flushEditor(tabId: string): Promise<void> {
  const fn = savers.get(tabId);
  if (fn) await fn();
}

/**
 * Flush every registered editor buffer. Used by the quit handshake so unsaved
 * edits aren't lost when the user hits Cmd+Q within the autosave window. Each
 * saver no-ops when its buffer is clean, so this is cheap in the common case.
 */
export async function flushAllEditors(): Promise<void> {
  await Promise.all(Array.from(savers.values()).map((fn) => fn().catch(() => undefined)));
}
