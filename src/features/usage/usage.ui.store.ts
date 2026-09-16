import { create } from "zustand";
import type { UsageProviderId } from "./usage.types";

interface UsageUiState {
  open: boolean;
  selected: UsageProviderId | null;
  returnFocusTo: HTMLElement | null;
  show: (provider?: UsageProviderId | null, opener?: HTMLElement | null) => void;
  select: (provider: UsageProviderId | null) => void;
  close: () => void;
}

export const useUsageUiStore = create<UsageUiState>((set) => ({
  open: false, selected: null, returnFocusTo: null,
  show: (selected = null, opener) => set({ open: true, selected, returnFocusTo: opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null) }),
  select: (selected) => set({ selected }),
  close: () => set({ open: false }),
}));
