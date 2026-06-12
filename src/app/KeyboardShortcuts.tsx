import { useEffect } from "react";

import { useKeybindingsStore } from "@/features/keybindings/keybindings.store";
import type { ResolvedCommand } from "@/features/keybindings/types";
import { useSettingsStore } from "@/features/settings/settings.store";
import { useSearchUiStore } from "@/features/search/search.store";
import { useCommandPaletteStore } from "@/features/command-palette/command-palette.store";
import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";
import { useViewStore } from "@/features/ui/view.store";

/** Commands that still make sense while the Agent overlay covers the Code
 *  view. Everything else (new terminal, close tab, project switch, palettes)
 *  mutates or surfaces Code chrome the user cannot see, so it is swallowed. */
const AGENT_SAFE_COMMANDS = new Set<string>([
  "settings.open",
  "diagnostics.toggle",
  "agent.newChat",
  "view.toggle",
]);

interface MetacodexApi {
  newTerminal?: () => void;
  openFolder?: () => void;
  cloneFromGithub?: () => void;
  closeActiveTab?: () => void;
  switchProject?: (n: number) => void;
  jumpToNextAttention?: () => void;
  renameActiveTab?: () => void;
  moveActiveTab?: (delta: -1 | 1) => void;
  activateAdjacentTab?: (delta: -1 | 1) => void;
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
    case "folder.clone":
      api?.cloneFromGithub?.();
      break;
    case "tab.close":
      api?.closeActiveTab?.();
      break;
    case "tab.rename":
      api?.renameActiveTab?.();
      break;
    case "tab.moveLeft":
      api?.moveActiveTab?.(-1);
      break;
    case "tab.moveRight":
      api?.moveActiveTab?.(1);
      break;
    case "tab.next":
      api?.activateAdjacentTab?.(1);
      break;
    case "tab.previous":
      api?.activateAdjacentTab?.(-1);
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
    case "tab.jumpToNextAttention":
      api?.jumpToNextAttention?.();
      break;
    case "agent.newChat":
      // Agent-view only: in the Code view Cmd+K stays a no-op rather than
      // yanking the user into another surface.
      if (useViewStore.getState().view === "agent") {
        void import("@/features/agent/nav.store").then(({ useAgentNavStore }) => {
          useAgentNavStore.getState().setSection("chat");
        });
        void import("@/features/agent/chat.store").then(({ useAgentChatStore }) => {
          useAgentChatStore.getState().newChat();
        });
      }
      break;
    case "view.toggle":
      useViewStore.getState().toggleView();
      break;
    case "diagnostics.toggle":
      useDiagnosticsStore.getState().toggle();
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
      if (useViewStore.getState().view === "agent" && !AGENT_SAFE_COMMANDS.has(cmd.id)) return;
      dispatchCommand(cmd);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return null;
}
