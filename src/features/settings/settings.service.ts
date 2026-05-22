import { CMD, invoke } from "@/lib/ipc";

import type { AppSettings } from "./settings.types";

/**
 * IPC wrapper for `~/.metacodex/settings.json`. Mirrors `workspace.service.ts`.
 * `read` returns the raw parsed JSON (or null on first run / empty file); the
 * store validates it via `mergeSettings`. `write` sends the full settings object
 * — the param name `settings` must match the Rust command's argument.
 */
export const settingsApi = {
  async read(): Promise<unknown> {
    return (await invoke<unknown>(CMD.readSettings)) ?? null;
  },
  write(settings: AppSettings): Promise<void> {
    return invoke<void>(CMD.writeSettings, { settings });
  },
};
