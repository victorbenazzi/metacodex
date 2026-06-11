import { create } from "zustand";

/** Top-level tab of the settings dialog: Code (workspace) vs Agent. */
export type SettingsTab = "code" | "agent";

interface SettingsState {
  open: boolean;
  /** Which tab the dialog shows; survives close so reopening feels stable. */
  tab: SettingsTab;
  setOpen: (open: boolean) => void;
  setTab: (tab: SettingsTab) => void;
  /** Open the dialog straight onto a tab (e.g. the Agent view's gear). */
  openTab: (tab: SettingsTab) => void;
  toggle: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  open: false,
  tab: "code",
  setOpen: (open) => set({ open }),
  setTab: (tab) => set({ tab }),
  openTab: (tab) => set({ open: true, tab }),
  toggle: () => set({ open: !get().open }),
}));
