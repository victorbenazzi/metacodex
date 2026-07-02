import { create } from "zustand";

export type SidePanelTool = "review";

interface SidePanelState {
  open: boolean;
  activeTool: SidePanelTool | null;
  toggle: (tool?: SidePanelTool) => void;
  setOpen: (open: boolean) => void;
  setActiveTool: (tool: SidePanelTool | null) => void;
}

export const useSidePanelStore = create<SidePanelState>((set) => ({
  open: false,
  activeTool: null,
  toggle: (tool) =>
    set((s) => {
      if (tool) {
        return {
          open: !(s.open && s.activeTool === tool),
          activeTool: tool,
        };
      }
      return {
        open: !s.open,
        activeTool: s.open ? s.activeTool : null,
      };
    }),
  setOpen: (open) => set({ open }),
  setActiveTool: (tool) => set({ activeTool: tool, open: true }),
}));
