import { create } from "zustand";

export type LeftNav = "repos" | "loops";

interface V3ShellState {
  leftNav: LeftNav;
  setLeftNav: (nav: LeftNav) => void;
  newAgentOpen: boolean;
  setNewAgentOpen: (open: boolean) => void;
  openProjectOpen: boolean;
  setOpenProjectOpen: (open: boolean) => void;
}

export const useV3ShellStore = create<V3ShellState>((set) => ({
  leftNav: "repos",
  setLeftNav: (leftNav) => set({ leftNav }),
  newAgentOpen: false,
  setNewAgentOpen: (newAgentOpen) => set({ newAgentOpen }),
  openProjectOpen: false,
  setOpenProjectOpen: (openProjectOpen) => set({ openProjectOpen }),
}));
