import { create } from "zustand";
import { getVersion } from "@tauri-apps/api/app";

import { CMD, invoke } from "@/lib/ipc";
import {
  CHANGELOG,
  compareVersions,
  latestEntryFor,
  type ChangelogEntry,
} from "./changelog";

interface WhatsNewState {
  open: boolean;
  entry: ChangelogEntry | null;
  /**
   * Boot check: opens the dialog when the app version changed since the last
   * run AND a changelog entry covers the new version. A fresh install (no
   * marker yet) just records the version silently; nobody wants release notes
   * for a version they never used before.
   */
  maybeShowOnBoot: () => Promise<void>;
  /** Open the newest entry unconditionally (About pane "what's new" link). */
  showLatest: () => void;
  dismiss: () => void;
}

async function persistSeen(): Promise<void> {
  const version = await getVersion();
  await invoke(CMD.writeWhatsNew, { state: { lastSeenVersion: version } });
}

/** Module-level: React StrictMode double-mounts effects in dev; one check. */
let bootChecked = false;

export const useWhatsNewStore = create<WhatsNewState>((set) => ({
  open: false,
  entry: null,

  maybeShowOnBoot: async () => {
    if (bootChecked) return;
    bootChecked = true;
    try {
      const version = await getVersion();
      const raw = await invoke<Record<string, unknown>>(CMD.readWhatsNew);
      const lastSeen =
        typeof raw.lastSeenVersion === "string" ? raw.lastSeenVersion : null;
      if (lastSeen === null) {
        // No marker yet: either a fresh install or an existing user whose
        // previous build predates this feature. Registered projects are the
        // tiebreak (the Rust registry hydrates before the webview loads):
        // an existing user gets the notes once, a fresh install stays quiet.
        const projects = await invoke<unknown[]>(CMD.listProjects);
        if (Array.isArray(projects) && projects.length > 0) {
          const entry = latestEntryFor(version);
          if (entry) {
            set({ entry, open: true });
            return;
          }
        }
        await persistSeen();
        return;
      }
      if (compareVersions(version, lastSeen) === 0) return;
      const entry = latestEntryFor(version);
      if (entry && compareVersions(entry.version, lastSeen) > 0) {
        // Marker is persisted on dismiss, so a crash before the user reads
        // the notes shows them again next boot.
        set({ entry, open: true });
        return;
      }
      // Version changed but nothing to announce (or downgrade): mark seen.
      await persistSeen();
    } catch (err) {
      console.warn("[whats-new] boot check failed", err);
    }
  },

  showLatest: () => {
    const entry = CHANGELOG[0];
    if (entry) set({ entry, open: true });
  },

  dismiss: () => {
    set({ open: false });
    void persistSeen().catch((err) =>
      console.warn("[whats-new] persist failed", err),
    );
  },
}));
