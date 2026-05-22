import { create } from "zustand";

import { bindingKey, eventToBinding, formatBinding, matchBinding, parseBinding } from "./binding";
import { COMMANDS, COMMANDS_BY_ID, RANGE_COMMANDS } from "./commands";
import { keybindingsApi, type KeybindingOverrides } from "./ipc";
import type { CommandId, ResolvedCommand } from "./types";

interface KeybindingsState {
  hydrated: boolean;
  /** User overrides only (commandId → binding strings); replaces the default. */
  overrides: KeybindingOverrides;
  /** Resolution table: canonical binding key → command id (range cmds excluded). */
  table: Map<string, CommandId>;
  /** Bindings claimed by more than one command (canonical key → ids). */
  conflicts: Record<string, CommandId[]>;
  /** True while a Settings chip is capturing keys — suppresses global dispatch. */
  captureActive: boolean;

  hydrate: () => Promise<void>;
  resolve: (e: KeyboardEvent) => ResolvedCommand | null;
  bindingsFor: (id: CommandId) => string[];
  rebind: (id: CommandId, binding: string) => void;
  resetToDefault: (id: CommandId) => void;
  resetAll: () => void;
  findConflict: (binding: string, exceptId: CommandId) => CommandId | null;
  setCaptureActive: (active: boolean) => void;
}

/** Effective bindings per command = override ?? default. */
function effectiveBindings(overrides: KeybindingOverrides): Map<CommandId, string[]> {
  const map = new Map<CommandId, string[]>();
  for (const c of COMMANDS) {
    map.set(c.id, overrides[c.id] ?? c.defaultBinding);
  }
  return map;
}

function buildTable(overrides: KeybindingOverrides): {
  table: Map<string, CommandId>;
  conflicts: Record<string, CommandId[]>;
} {
  const table = new Map<string, CommandId>();
  const conflicts: Record<string, CommandId[]> = {};
  const eff = effectiveBindings(overrides);
  for (const c of COMMANDS) {
    if (c.range) continue; // range commands resolve via matchBinding's range path
    for (const b of eff.get(c.id) ?? []) {
      const key = bindingKey(parseBinding(b));
      const existing = table.get(key);
      if (existing && existing !== c.id) {
        conflicts[key] = [...(conflicts[key] ?? [existing]), c.id];
        continue; // keep the first (deterministic) winner so dispatch never double-fires
      }
      table.set(key, c.id);
    }
  }
  return { table, conflicts };
}

function persist(overrides: KeybindingOverrides) {
  void keybindingsApi
    .write(overrides)
    .catch((err) => console.error("[keybindings] persist failed", err));
}

export const useKeybindingsStore = create<KeybindingsState>((set, get) => ({
  hydrated: false,
  overrides: {},
  table: buildTable({}).table,
  conflicts: {},
  captureActive: false,

  hydrate: async () => {
    try {
      const raw = await keybindingsApi.read();
      const overrides: KeybindingOverrides = {};
      for (const [id, val] of Object.entries(raw)) {
        // Drop unknown ids (forward-compat) and malformed values.
        if (id in COMMANDS_BY_ID && Array.isArray(val) && val.every((x) => typeof x === "string")) {
          overrides[id as CommandId] = val as string[];
        }
      }
      const { table, conflicts } = buildTable(overrides);
      set({ overrides, table, conflicts, hydrated: true });
    } catch (err) {
      console.error("[keybindings] hydrate failed", err);
      set({ hydrated: true });
    }
  },

  resolve: (e) => matchBinding(eventToBinding(e), get().table, RANGE_COMMANDS),

  bindingsFor: (id) => get().overrides[id] ?? COMMANDS_BY_ID[id].defaultBinding,

  rebind: (id, binding) => {
    const normalized = formatBinding(parseBinding(binding));
    const key = bindingKey(parseBinding(normalized));
    const overrides: KeybindingOverrides = { ...get().overrides };
    // Reassign: take this binding away from whatever command currently holds it,
    // so the new owner is exclusive (the previous owner may become unbound).
    const eff = effectiveBindings(overrides);
    for (const [cid, binds] of eff) {
      if (cid === id) continue;
      if (binds.some((b) => bindingKey(parseBinding(b)) === key)) {
        overrides[cid] = binds.filter((b) => bindingKey(parseBinding(b)) !== key);
      }
    }
    overrides[id] = [normalized];
    const { table, conflicts } = buildTable(overrides);
    set({ overrides, table, conflicts });
    persist(overrides);
  },

  resetToDefault: (id) => {
    const overrides: KeybindingOverrides = { ...get().overrides };
    delete overrides[id];
    const { table, conflicts } = buildTable(overrides);
    set({ overrides, table, conflicts });
    persist(overrides);
  },

  resetAll: () => {
    const { table, conflicts } = buildTable({});
    set({ overrides: {}, table, conflicts });
    persist({});
  },

  findConflict: (binding, exceptId) => {
    const key = bindingKey(parseBinding(binding));
    const owner = get().table.get(key);
    return owner && owner !== exceptId ? owner : null;
  },

  setCaptureActive: (active) => set({ captureActive: active }),
}));
