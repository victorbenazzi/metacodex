import { create } from "zustand";

import { useCommandPaletteStore } from "@/features/command-palette/command-palette.store";
import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";
import { useSearchUiStore } from "@/features/search/search.store";
import { useSettingsStore } from "@/features/settings/settings.store";
import { useV3ShellStore } from "@/features/v3-shell/v3Shell.store";
import { useWhatsNewStore } from "@/features/whats-new/whatsNew.store";

interface OverlayLockState {
  local: boolean;
  setLocal: (local: boolean) => void;
}

/** Dialogs that live as local React state in AppShell (worktree, clone, confirm). */
export const useOverlayLockStore = create<OverlayLockState>((set) => ({
  local: false,
  setLocal: (local) => set({ local }),
}));

export function useChromeOverlayOpen(): boolean {
  const settings = useSettingsStore((s) => s.open);
  const palette = useCommandPaletteStore((s) => s.open);
  const search = useSearchUiStore((s) => s.open);
  const diagnostics = useDiagnosticsStore((s) => s.open);
  const newAgent = useV3ShellStore((s) => s.newAgentOpen);
  const openProject = useV3ShellStore((s) => s.openProjectOpen);
  const whatsNew = useWhatsNewStore((s) => s.open);
  const local = useOverlayLockStore((s) => s.local);
  return (
    settings ||
    palette ||
    search ||
    diagnostics ||
    newAgent ||
    openProject ||
    whatsNew ||
    local
  );
}
