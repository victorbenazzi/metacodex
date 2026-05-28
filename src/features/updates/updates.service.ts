import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { useUpdatesStore } from "./updates.store";

let cachedUpdate: Update | null = null;

/**
 * Boot-time silent probe. In `tauri dev` the updater plugin has no installed
 * app to compare against and `check()` throws — we skip the call entirely.
 * Any other failure (network down, malformed manifest) is swallowed so it
 * never reaches the console: the absence of a pill is the user-visible signal.
 */
export async function checkSilent(): Promise<void> {
  if (import.meta.env.DEV) return;
  const store = useUpdatesStore.getState();
  if (store.status.kind !== "idle" && store.status.kind !== "error") return;

  store.setStatus({ kind: "checking" });
  try {
    const update = await check();
    if (!update) {
      store.setStatus({ kind: "idle" });
      cachedUpdate = null;
      return;
    }
    cachedUpdate = update;
    store.setStatus({
      kind: "available",
      version: update.version,
      notes: update.body,
    });
  } catch {
    store.setStatus({ kind: "idle" });
    cachedUpdate = null;
  }
}

export type ManualCheckResult =
  | { kind: "available"; version: string }
  | { kind: "up-to-date" }
  | { kind: "dev" }
  | { kind: "error"; message: string };

/**
 * Explicit check triggered from the About pane. Same wire path as
 * `checkSilent`, but surfaces the outcome to the caller instead of swallowing
 * it — the About pane uses the result to render an inline "you're on the
 * latest" or "couldn't check" affordance next to the button. Errors are also
 * pushed to the store so the topbar pill can react.
 */
export async function checkForUpdatesManual(): Promise<ManualCheckResult> {
  if (import.meta.env.DEV) return { kind: "dev" };
  const store = useUpdatesStore.getState();
  store.setStatus({ kind: "checking" });
  try {
    const update = await check();
    if (!update) {
      store.setStatus({ kind: "idle" });
      cachedUpdate = null;
      return { kind: "up-to-date" };
    }
    cachedUpdate = update;
    store.setStatus({
      kind: "available",
      version: update.version,
      notes: update.body,
    });
    return { kind: "available", version: update.version };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.setStatus({ kind: "error", message });
    return { kind: "error", message };
  }
}

/**
 * User clicked the pill. Drives downloadAndInstall, streaming progress into
 * the store; on completion we relaunch the app so the new binary boots clean.
 * On failure we surface a terse error — clicking again retries.
 */
export async function startInstall(): Promise<void> {
  const store = useUpdatesStore.getState();
  const update = cachedUpdate;
  if (!update) {
    store.setStatus({ kind: "idle" });
    return;
  }

  let downloaded = 0;
  let total: number | null = null;

  store.setStatus({
    kind: "downloading",
    version: update.version,
    downloaded: 0,
    total: null,
  });

  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      } else if (event.event === "Finished") {
        useUpdatesStore.getState().setStatus({
          kind: "installing",
          version: update.version,
        });
        return;
      }
      // Throttle store writes: only emit when state actually changed
      const current = useUpdatesStore.getState().status;
      if (
        current.kind === "downloading" &&
        (current.downloaded !== downloaded || current.total !== total)
      ) {
        useUpdatesStore.getState().setStatus({
          kind: "downloading",
          version: update.version,
          downloaded,
          total,
        });
      }
    });
    // Plugin handles the actual install; relaunch hands control to the new
    // binary. If relaunch itself throws, we leave the pill in "installing".
    await relaunch();
  } catch (err) {
    useUpdatesStore.getState().setStatus({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
