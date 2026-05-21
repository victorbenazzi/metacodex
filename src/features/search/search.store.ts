import { create } from "zustand";

interface SearchUiState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useSearchUiStore = create<SearchUiState>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
}));

/** Pending "go to line N" map for editor tabs. Set when a search result is
 * clicked; EditorTab reads + clears on mount/HMR. */
interface PendingGotoState {
  byTab: Record<string, number | undefined>;
  set: (tabId: string, line: number) => void;
  consume: (tabId: string) => number | undefined;
}

export const usePendingGotoStore = create<PendingGotoState>((set, get) => ({
  byTab: {},
  set: (tabId, line) =>
    set((s) => ({ byTab: { ...s.byTab, [tabId]: line } })),
  consume: (tabId) => {
    const line = get().byTab[tabId];
    if (line != null) {
      set((s) => {
        const { [tabId]: _, ...rest } = s.byTab;
        return { byTab: rest };
      });
    }
    return line;
  },
}));
