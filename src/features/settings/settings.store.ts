import { create } from "zustand";

interface SettingsState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
}));
