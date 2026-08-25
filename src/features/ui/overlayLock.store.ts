import { useId, useLayoutEffect } from "react";
import { create } from "zustand";

import { useCommandPaletteStore } from "@/features/command-palette/command-palette.store";
import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";
import { useSearchUiStore } from "@/features/search/search.store";
import { useSettingsStore } from "@/features/settings/settings.store";
import { useV3ShellStore } from "@/features/v3-shell/v3Shell.store";
import { useWhatsNewStore } from "@/features/whats-new/whatsNew.store";

interface OverlayLockState {
  local: boolean;
  dialogs: Record<string, true>;
  setLocal: (local: boolean) => void;
  setDialog: (id: string, open: boolean) => void;
}

/** Dialogs that live as local React state in AppShell (worktree, clone, confirm). */
export const useOverlayLockStore = create<OverlayLockState>((set) => ({
  local: false,
  dialogs: {},
  setLocal: (local) => set({ local }),
  setDialog: (id, open) => set((state) => {
    if (open) {
      if (state.dialogs[id]) return state;
      return { dialogs: { ...state.dialogs, [id]: true } };
    }
    if (!state.dialogs[id]) return state;
    const dialogs = { ...state.dialogs };
    delete dialogs[id];
    return { dialogs };
  }),
}));

/** Registers controlled dialogs that use local component state. */
export function useOverlayLock(open: boolean): void {
  const id = useId();
  useLayoutEffect(() => {
    useOverlayLockStore.getState().setDialog(id, open);
    return () => useOverlayLockStore.getState().setDialog(id, false);
  }, [id, open]);
}

export function useChromeOverlayOpen(): boolean {
  const settings = useSettingsStore((s) => s.open);
  const palette = useCommandPaletteStore((s) => s.open);
  const search = useSearchUiStore((s) => s.open);
  const diagnostics = useDiagnosticsStore((s) => s.open);
  const newAgent = useV3ShellStore((s) => s.newAgentOpen);
  const openProject = useV3ShellStore((s) => s.openProjectOpen);
  const whatsNew = useWhatsNewStore((s) => s.open);
  const local = useOverlayLockStore((s) => s.local);
  const localDialogOpen = useOverlayLockStore(
    (s) => Object.keys(s.dialogs).length > 0,
  );
  return (
    settings ||
    palette ||
    search ||
    diagnostics ||
    newAgent ||
    openProject ||
    whatsNew ||
    local ||
    localDialogOpen
  );
}
