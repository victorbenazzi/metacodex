import { create } from "zustand";

interface V3ShellState {
  newAgentOpen: boolean;
  setNewAgentOpen: (open: boolean) => void;
  openProjectOpen: boolean;
  setOpenProjectOpen: (open: boolean) => void;
}

export const useV3ShellStore = create<V3ShellState>((set) => ({
  newAgentOpen: false,
  setNewAgentOpen: (newAgentOpen) => set({ newAgentOpen }),
  openProjectOpen: false,
  setOpenProjectOpen: (openProjectOpen) => set({ openProjectOpen }),
}));
