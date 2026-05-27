import { create } from "zustand";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; notes?: string }
  | {
      kind: "downloading";
      version: string;
      downloaded: number;
      total: number | null;
    }
  | { kind: "installing"; version: string }
  | { kind: "error"; message: string };

interface UpdatesState {
  status: UpdateStatus;
  setStatus: (status: UpdateStatus) => void;
  reset: () => void;
}

export const useUpdatesStore = create<UpdatesState>((set) => ({
  status: { kind: "idle" },
  setStatus: (status) => set({ status }),
  reset: () => set({ status: { kind: "idle" } }),
}));
