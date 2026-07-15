import { create } from "zustand";

import type { PendingClose } from "./closePolicy";

/**
 * Shared Close request dialog state so every UI surface (tab bar, vertical
 * sidebar, shortcuts) can raise the same confirm without prop drilling.
 */
interface PendingCloseState {
  pending: PendingClose | null;
  setPending: (pending: PendingClose | null) => void;
  clear: () => void;
}

export const usePendingCloseStore = create<PendingCloseState>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
  clear: () => set({ pending: null }),
}));
