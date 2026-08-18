import { create } from "zustand";

/**
 * Loop cards shown in the v3 sidebar. The shape matches metacodex-v2
 * (`LoopListItem`: id, name, goal, maker/verify kinds) so the visual can
 * later bind to the v2 orchestrator without another UI pass.
 */
export interface LoopListItem {
  id: string;
  name?: string;
  goal: string;
  makerKind: string;
  verifyKind: string;
}

interface LoopsState {
  loops: LoopListItem[];
  selectedId: string | null;
  select: (id: string | null) => void;
}

export const useLoopsStore = create<LoopsState>((set) => ({
  loops: [],
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
}));
