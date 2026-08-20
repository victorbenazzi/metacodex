import { CMD, invoke } from "@/lib/ipc";
import { useThemeStore } from "@/features/theme/theme.store";
import type {
  PtyAttachResponse,
  PtyPrepareResponse,
  PtySpawnSpec,
} from "./terminal.types";

export const ptyApi = {
  // `theme_kind` is injected here, not accepted from callers: the Omit makes
  // that a compile error, and spreading it LAST means the injection always wins.
  prepare(spec: Omit<PtySpawnSpec, "theme_kind">): Promise<PtyPrepareResponse> {
    // Stamp the current theme kind so the backend can export COLORFGBG and
    // background-detecting TUIs start with matching colors. One injection
    // point here keeps every preparation path (new tab, resume, CLI) covered.
    const themed: PtySpawnSpec = {
      ...spec,
      theme_kind: useThemeStore.getState().effective,
    };
    return invoke<PtyPrepareResponse>(CMD.ptyPrepare, { spec: themed });
  },
  attach(sessionId: string, afterSeq: number): Promise<PtyAttachResponse> {
    return invoke<PtyAttachResponse>(CMD.ptyAttach, { sessionId, afterSeq });
  },
  start(sessionId: string): Promise<void> {
    return invoke<void>(CMD.ptyStart, { sessionId });
  },
  write(sessionId: string, dataB64: string): Promise<void> {
    return invoke<void>(CMD.ptyWrite, { sessionId, dataB64 });
  },
  resize(sessionId: string, rows: number, cols: number): Promise<void> {
    return invoke<void>(CMD.ptyResize, { sessionId, rows, cols });
  },
  kill(sessionId: string): Promise<void> {
    return invoke<void>(CMD.ptyKill, { sessionId });
  },
  killProcess(sessionId: string, pid: number): Promise<void> {
    return invoke<void>(CMD.ptyKillProcess, { sessionId, pid });
  },
  list(): Promise<unknown[]> {
    return invoke<unknown[]>(CMD.ptyList);
  },
};
