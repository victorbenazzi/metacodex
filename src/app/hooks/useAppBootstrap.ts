import { useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { useEditorReconcile } from "@/features/editor/useEditorReconcile";
import { preloadCliDetections } from "@/features/terminal/cli-detection";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { UI_DENSITY_MULTIPLIER, UI_SCALE_FACTOR } from "@/features/settings/settings.types";
import { useKeybindingsStore } from "@/features/keybindings/keybindings.store";
import { useResumeStore } from "@/features/resume/resume.store";
import {
  EV,
  listenTo,
  type PtyBackpressurePayload,
  type PtyExitPayload,
} from "@/lib/events";
import { recordDiag } from "@/features/diagnostics/diagnostics.store";
import { checkSilent as checkUpdatesSilent } from "@/features/updates/updates.service";
import { useTabMetadataPolling } from "@/features/terminal/useTabMetadataPolling";
import { useWorktreeOccupancySync } from "@/features/git/useWorktreeOccupancySync";

export function useAppBootstrap(): { homeDirPath: string | null } {
  const [homeDirPath, setHomeDirPath] = useState<string | null>(null);

  const projectsHydrated = useProjectsStore((s) => s.hydrated);
  const hydrateProjects = useProjectsStore((s) => s.hydrate);
  const settingsHydrated = useSettingsDataStore((s) => s.hydrated);
  const hydrateSettings = useSettingsDataStore((s) => s.hydrate);
  const keybindingsHydrated = useKeybindingsStore((s) => s.hydrated);
  const hydrateKeybindings = useKeybindingsStore((s) => s.hydrate);
  const uiDensity = useSettingsDataStore((s) => s.settings.interface.uiDensity);
  const uiScale = useSettingsDataStore((s) => s.settings.accessibility.uiScale);

  useEffect(() => {
    if (!projectsHydrated) hydrateProjects();
  }, [projectsHydrated, hydrateProjects]);

  useEffect(() => {
    if (!settingsHydrated) hydrateSettings();
  }, [settingsHydrated, hydrateSettings]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--density-multiplier",
      String(UI_DENSITY_MULTIPLIER[uiDensity]),
    );
  }, [uiDensity]);

  // Native webview zoom (VS Code style window zoom). Fires at mount with the
  // default factor (visual no-op) and again once the persisted value hydrates
  // or the user changes it. Failure is non-fatal: the app stays at 1.0 but the
  // setting persists, so a binary carrying the zoom capability picks it up on
  // the next launch.
  useEffect(() => {
    getCurrentWebview()
      .setZoom(UI_SCALE_FACTOR[uiScale])
      .catch((err) => console.warn("[accessibility] setZoom failed", err));
  }, [uiScale]);

  useEffect(() => {
    if (!keybindingsHydrated) hydrateKeybindings();
  }, [keybindingsHydrated, hydrateKeybindings]);

  useEffect(() => {
    void useResumeStore.getState().hydrate();
  }, []);

  useEffect(() => {
    preloadCliDetections();
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void checkUpdatesSilent();
    }, 3000);
    return () => window.clearTimeout(handle);
  }, []);

  useEditorReconcile();
  useTabMetadataPolling();
  useWorktreeOccupancySync();

  useEffect(() => {
    (async () => {
      try {
        const h = await homeDir();
        setHomeDirPath(h.replace(/\/+$/, ""));
      } catch {
        setHomeDirPath(null);
      }
    })();
  }, []);

  useEffect(() => {
    let offBp: (() => void) | undefined;
    let offExit: (() => void) | undefined;
    (async () => {
      offBp = await listenTo<PtyBackpressurePayload>(EV.ptyBackpressure, (e) => {
        recordDiag("pty.backpressure", {
          sessionId: e.payload.sessionId,
          detail: { queueDepth: e.payload.queueDepth, stalledMs: e.payload.stalledMs },
        });
      });
      offExit = await listenTo<PtyExitPayload>(EV.ptyExit, (e) => {
        const reason = e.payload.reason ?? "normal";
        const kind = reason === "reader_error" ? "pty.reader_error" : "pty.exit";
        recordDiag(kind, {
          sessionId: e.payload.session_id,
          detail: { exitCode: e.payload.exit_code, reason },
        });
      });
    })();
    return () => {
      offBp?.();
      offExit?.();
    };
  }, []);

  return { homeDirPath };
}
