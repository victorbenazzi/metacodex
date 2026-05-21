import { CMD, invoke } from "@/lib/ipc";
import type { PtySpawnSpec } from "./terminal.types";

export const ptyApi = {
  spawn(spec: PtySpawnSpec): Promise<string> {
    return invoke<string>(CMD.ptySpawn, { spec });
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
