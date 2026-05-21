import { useEffect } from "react";
import { isMac } from "@/lib/platform";
import { useSettingsStore } from "@/features/settings/settings.store";
import { useSearchUiStore } from "@/features/search/search.store";

/**
 * Global keyboard shortcuts. Reads runtime handlers off `window.__metacodex` set
 * by AppShell. Cmd+T (new terminal), Cmd+O (open folder), Cmd+W (close active),
 * Cmd+1..9 (switch project), Cmd+S (save active editor — handled inline by the
 * editor itself, but we let it bubble here as a no-op so the default browser
 * action doesn't fire).
 */
export function KeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      const api = (window as any).__metacodex as
        | {
            newTerminal?: () => void;
            openFolder?: () => void;
            closeActiveTab?: () => void;
            switchProject?: (n: number) => void;
          }
        | undefined;
      if (!api) return;

      const k = e.key;

      // Cmd+T → new terminal
      if (!e.repeat && (k === "t" || k === "T")) {
        e.preventDefault();
        api.newTerminal?.();
        return;
      }

      // Cmd+O → open folder
      if (!e.repeat && (k === "o" || k === "O")) {
        e.preventDefault();
        api.openFolder?.();
        return;
      }

      // Cmd+W → close active tab
      if (!e.repeat && (k === "w" || k === "W")) {
        e.preventDefault();
        api.closeActiveTab?.();
        return;
      }

      // Cmd+1..9 → switch to Nth project
      if (!e.repeat && /^[1-9]$/.test(k)) {
        e.preventDefault();
        api.switchProject?.(parseInt(k, 10));
        return;
      }

      // Cmd+, → open Settings (macOS convention)
      if (!e.repeat && k === ",") {
        e.preventDefault();
        useSettingsStore.getState().setOpen(true);
        return;
      }

      // Cmd+Shift+F → search across files
      if (!e.repeat && e.shiftKey && (k === "f" || k === "F")) {
        e.preventDefault();
        useSearchUiStore.getState().setOpen(true);
        return;
      }

      // Cmd+S → swallow if not handled by CodeMirror (prevents browser Save Page)
      if (!e.repeat && (k === "s" || k === "S")) {
        // Don't preventDefault — CodeMirror has its own Mod-s binding when
        // focused. If nothing handled it (no editor focused), this is a no-op.
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return null;
}
