import { create } from "zustand";

export type PaletteMode = "files" | "commands";

interface CommandPaletteState {
  open: boolean;
  mode: PaletteMode;
  openFiles: () => void;
  openCommands: () => void;
  close: () => void;
}

/** Controls the command palette — go-to-file (Cmd+P) and commands (Cmd+Shift+P). */
export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  mode: "files",
  openFiles: () => set({ open: true, mode: "files" }),
  openCommands: () => set({ open: true, mode: "commands" }),
  close: () => set({ open: false }),
}));
