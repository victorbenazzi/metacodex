import { CMD, invoke } from "@/lib/ipc";
import { useThemeStore } from "@/features/theme/theme.store";
import type { PtySpawnSpec } from "./terminal.types";

export const ptyApi = {
  spawn(spec: PtySpawnSpec): Promise<string> {
    // Stamp the current theme kind so the backend can export COLORFGBG and
    // background-detecting TUIs start with matching colors. One injection
    // point here keeps every spawn path (new tab, resume, CLI) covered.
    const themed: PtySpawnSpec = {
      theme_kind: useThemeStore.getState().effective,
      ...spec,
    };
    return invoke<string>(CMD.ptySpawn, { spec: themed });
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
  list(): Promise<unknown[]> {
    return invoke<unknown[]>(CMD.ptyList);
  },
};
