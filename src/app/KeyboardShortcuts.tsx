import { useEffect } from "react";

import { useKeybindingsStore } from "@/features/keybindings/keybindings.store";
import type { ResolvedCommand } from "@/features/keybindings/types";
import { useSettingsStore } from "@/features/settings/settings.store";
import { useSearchUiStore } from "@/features/search/search.store";
import { useCommandPaletteStore } from "@/features/command-palette/command-palette.store";
import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { projectCapabilities } from "@/features/projects/project.types";
import { getAppCommands } from "@/app/appCommands";

/**
 * Route a resolved command to its side effect. Implementations stay on
 * `appCommands` (registered by AppShell) or the relevant feature stores. This
 * function only dispatches, keeping the keybindings registry side-effect-free.
 */
function dispatchCommand(cmd: ResolvedCommand) {
  const api = getAppCommands();
  switch (cmd.id) {
    case "terminal.new":
      api?.newTerminal();
      break;
    case "folder.open":
      api?.openFolder();
      break;
    case "folder.clone":
      api?.cloneFromGithub();
      break;
    case "tab.close":
      api?.closeActiveTab();
      break;
    case "tab.rename":
      api?.renameActiveTab();
      break;
    case "tab.moveLeft":
      api?.moveActiveTab(-1);
      break;
    case "tab.moveRight":
      api?.moveActiveTab(1);
      break;
    case "tab.next":
      api?.activateAdjacentTab(1);
      break;
    case "tab.previous":
      api?.activateAdjacentTab(-1);
      break;
    case "project.switch":
      if (cmd.arg) api?.switchProject(cmd.arg);
      break;
    case "settings.open":
      useSettingsStore.getState().setOpen(true);
      break;
    case "search.inProject":
      if (activeProjectCan("search")) useSearchUiStore.getState().setOpen(true);
      break;
    case "palette.commands":
      useCommandPaletteStore.getState().openCommands();
      break;
    case "palette.files":
      if (activeProjectCan("search")) useCommandPaletteStore.getState().openFiles();
      break;
    case "file.save":
      // Passive commands return before dispatch; this case is for exhaustiveness.
      break;
    case "tab.jumpToNextAttention":
      api?.jumpToNextAttention();
      break;
    case "diagnostics.toggle":
      useDiagnosticsStore.getState().toggle();
      break;
  }
}

function activeProjectCan(capability: "search"): boolean {
  const state = useProjectsStore.getState();
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  return projectCapabilities(project)[capability];
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
      // Don't hijack plain/Alt keys while the user types in a text field:
      // Alt+Left/Right must stay the OS word-jump, F2 must not rename tabs
      // mid-typing. Mod-based combos (Cmd+T, Cmd+W...) still dispatch. xterm's
      // hidden helper textarea is exempt so shortcuts keep working while a
      // terminal is focused (xterm handles its own keys).
      const el = e.target instanceof HTMLElement ? e.target : null;
      const inTextField =
        !!el &&
        (el.isContentEditable || !!el.closest("input, textarea, select")) &&
        !el.closest(".xterm");
      if (inTextField && !e.metaKey && !e.ctrlKey) return;
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
