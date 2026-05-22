import { useEffect } from "react";

import { useKeybindingsStore } from "@/features/keybindings/keybindings.store";
import type { ResolvedCommand } from "@/features/keybindings/types";
import { useSettingsStore } from "@/features/settings/settings.store";
import { useSearchUiStore } from "@/features/search/search.store";
import { useCommandPaletteStore } from "@/features/command-palette/command-palette.store";

interface MetacodexApi {
  newTerminal?: () => void;
  openFolder?: () => void;
  closeActiveTab?: () => void;
  switchProject?: (n: number) => void;
}

/**
 * Route a resolved command to its side effect. Implementations stay on
 * `window.__metacodex` (set by AppShell) or the relevant feature stores — this
 * function only dispatches, keeping the keybindings registry side-effect-free.
 */
function dispatchCommand(cmd: ResolvedCommand) {
  const api = (window as any).__metacodex as MetacodexApi | undefined;
  switch (cmd.id) {
    case "terminal.new":
      api?.newTerminal?.();
      break;
    case "folder.open":
      api?.openFolder?.();
      break;
    case "tab.close":
      api?.closeActiveTab?.();
      break;
    case "project.switch":
      if (cmd.arg) api?.switchProject?.(cmd.arg);
      break;
    case "settings.open":
      useSettingsStore.getState().setOpen(true);
      break;
    case "search.inProject":
      useSearchUiStore.getState().setOpen(true);
      break;
    case "palette.commands":
      useCommandPaletteStore.getState().openCommands();
      break;
    case "palette.files":
      useCommandPaletteStore.getState().openFiles();
      break;
    case "file.save":
      // passive — never reached (returned before dispatch), here for exhaustiveness
      break;
  }
}

/**
 * Global keyboard shortcuts, resolved through the user-customizable keybindings
 * store. Cmd+S is `passive`: we never preventDefault it, so CodeMirror's own
 * Mod-s binding wins when an editor is focused (and nothing fires otherwise).
 */
export function KeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const kb = useKeybindingsStore.getState();
      // While a Settings chip is capturing a new combo, don't dispatch globally.
      if (kb.captureActive) return;
      const cmd = kb.resolve(e);
      if (!cmd) return;
      if (cmd.passive) return;
      e.preventDefault();
      dispatchCommand(cmd);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return null;
}
