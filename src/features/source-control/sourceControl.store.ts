import { create } from "zustand";

/**
 * Ephemeral UI state for the right-docked Source Control panel. Lives in memory
 * only — the panel starts closed on each launch (matching how terminals aren't
 * auto-respawned). Toggled from the title-bar button and Cmd-keybindings.
 */
interface SourceControlState {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

export const useSourceControlStore = create<SourceControlState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}));
