import { useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
import { setNativeWindowFocused } from "@/features/terminal/notificationDispatch";

export type BootstrapStatus = "loading" | "ready" | "failed";
let appReady = false;
export function isAppBootstrapReady(): boolean {
  return appReady;
}

export function useAppBootstrap(): {
  homeDirPath: string | null;
  status: BootstrapStatus;
  error: string | null;
  retry: () => void;
} {
  const [homeDirPath, setHomeDirPath] = useState<string | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);

  const projectsHydrated = useProjectsStore((s) => s.hydrated);
  const hydrateProjects = useProjectsStore((s) => s.hydrate);
  const projectsError = useProjectsStore((s) => s.hydrateError);
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
  // the next launch. getCurrentWebview() itself can throw synchronously when
  // Tauri internals are not injected yet (HMR, first paint), so the try wraps
  // the call, not only the Promise.
  useEffect(() => {
    const factor = UI_SCALE_FACTOR[uiScale];
    if (factor == null) return;
    try {
      void getCurrentWebview()
        .setZoom(factor)
        .catch((err) => console.warn("[accessibility] setZoom failed", err));
    } catch (err) {
      console.warn("[accessibility] setZoom failed", err);
    }
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
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().isFocused().then(setNativeWindowFocused).catch(() => undefined);
    void getCurrentWindow().onFocusChanged(({ payload }) => {
      if (!cancelled) setNativeWindowFocused(payload);
    }).then((off) => {
      if (cancelled) off();
      else unlisten = off;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
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
        setHomeError(null);
      } catch (error) {
        setHomeDirPath(null);
        setHomeError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [retryRevision]);

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

  const error = projectsError ?? homeError;
  const status: BootstrapStatus = error
    ? "failed"
    : projectsHydrated && settingsHydrated && keybindingsHydrated && homeDirPath
      ? "ready"
      : "loading";
  appReady = status === "ready";
  return {
    homeDirPath,
    status,
    error,
    retry: () => {
      useProjectsStore.setState({ hydrated: false, hydrateError: null });
      setHomeError(null);
      setRetryRevision((value) => value + 1);
    },
  };
}
