import { CMD, invoke } from "@/lib/ipc";

import type { CommandId } from "./types";

/** Persisted shape of `~/.metacodex/keybindings.json`: only the user's overrides
 *  (commandId → binding strings), so future default changes flow through. */
export type KeybindingOverrides = Partial<Record<CommandId, string[]>>;

export const keybindingsApi = {
  async read(): Promise<KeybindingOverrides> {
    const raw = await invoke<unknown>(CMD.readKeybindings);
    return raw && typeof raw === "object" ? (raw as KeybindingOverrides) : {};
  },
  write(overrides: KeybindingOverrides): Promise<void> {
    return invoke<void>(CMD.writeKeybindings, { keybindings: overrides });
  },
};
