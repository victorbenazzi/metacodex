import { useCallback, useEffect, useRef, useState } from "react";

import { flushAllEditors } from "@/features/editor/editorSavers";
import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";
import { flushResumeWrites } from "@/features/resume/resume.store";
import { flushSettings } from "@/features/settings/settings.data.store";
import { flushLoadedWorkspacesForQuit } from "@/app/hooks/useWorkspacePersistence";
import {
  EV,
  listenWhileMounted,
  type PrepareQuitPayload,
  type QuitBlockedPayload,
  type QuitFailure,
} from "@/lib/events";
import { CMD, invoke, isAppError } from "@/lib/ipc";

export type QuitFlushers = Record<string, () => Promise<void>>;

function failureFor(area: string, error: unknown): QuitFailure {
  if (isAppError(error)) return { area, code: error.code, message: error.message };
  if (error instanceof Error) return { area, code: "flush_failed", message: error.message };
  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; message?: unknown };
    return {
      area,
      code: typeof value.code === "string" ? value.code : "flush_failed",
      message: typeof value.message === "string" ? value.message : String(error),
    };
  }
  return { area, code: "flush_failed", message: String(error) };
}

export async function collectQuitFailures(flushers: QuitFlushers): Promise<QuitFailure[]> {
  const results = await Promise.allSettled(
    Object.entries(flushers).map(async ([area, flush]) => {
      await flush();
      return area;
    }),
  );
  const areas = Object.keys(flushers);
  return results.flatMap((result, index) =>
    result.status === "rejected" ? [failureFor(areas[index], result.reason)] : [],
  );
}

export interface QuitCoordinatorState {
  blocked: QuitBlockedPayload | null;
  retry: (token: string) => void;
  forceQuit: (token: string) => void;
}

export function useQuitCoordinator(): QuitCoordinatorState {
  const [blocked, setBlocked] = useState<QuitBlockedPayload | null>(null);
  const acknowledged = useRef(new Set<string>());

  useEffect(() => {
    const stopPrepare = listenWhileMounted<PrepareQuitPayload>(EV.prepareQuit, ({ payload }) => {
      if (acknowledged.current.has(payload.token)) return;
      acknowledged.current.add(payload.token);
      setBlocked(null);
      void collectQuitFailures({
        editors: flushAllEditors,
        settings: flushSettings,
        workspaces: flushLoadedWorkspacesForQuit,
        resume: flushResumeWrites,
        diagnostics: async () => {
          await invoke(CMD.diagWriteSessionLog, {
            payload: useDiagnosticsStore.getState().serialize(),
          });
        },
      }).then((failures) => invoke(CMD.appQuitReady, { token: payload.token, failures }));
    });
    const stopBlocked = listenWhileMounted<QuitBlockedPayload>(EV.quitBlocked, ({ payload }) => {
      setBlocked(payload);
    });
    return () => {
      stopPrepare();
      stopBlocked();
    };
  }, []);

  const retry = useCallback((token: string) => {
    void invoke(CMD.appRetryQuit, { token });
  }, []);
  const forceQuit = useCallback((token: string) => {
    void invoke(CMD.appForceQuit, { token });
  }, []);

  return { blocked, retry, forceQuit };
}
