import { create } from "zustand";

/**
 * The side panel is a single three-state surface, not an (open, tool) pair:
 * `closed` (hidden), `launcher` (the new-tab launcher), or `review` (the
 * source-control view). One field rules out the meaningless "closed but a tool
 * is selected" state the old shape allowed.
 */
export type SidePanelView = "closed" | "launcher" | "review";

interface SidePanelState {
  view: SidePanelView;
  /** Title-bar button: closed opens the launcher, anything open closes it. */
  toggle: () => void;
  close: () => void;
  showLauncher: () => void;
  showReview: () => void;
}

export const useSidePanelStore = create<SidePanelState>((set) => ({
  view: "closed",
  toggle: () => set((s) => ({ view: s.view === "closed" ? "launcher" : "closed" })),
  close: () => set({ view: "closed" }),
  showLauncher: () => set({ view: "launcher" }),
  showReview: () => set({ view: "review" }),
}));
