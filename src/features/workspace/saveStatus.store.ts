import { create } from "zustand";

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

interface SaveStatusState {
  status: SaveStatus;
  /** Wall-clock ms of the last successful save. Used by the TitleBar dot to
   *  fade the green pip back out a couple seconds after success. */
  lastSavedAt: number | null;
  lastError: string | null;
  beginSave: () => void;
  markSaved: () => void;
  markFailed: (error: string) => void;
}

export const useSaveStatusStore = create<SaveStatusState>((set) => ({
  status: "idle",
  lastSavedAt: null,
  lastError: null,
  beginSave: () => set({ status: "saving", lastError: null }),
  markSaved: () => set({ status: "saved", lastSavedAt: Date.now() }),
  markFailed: (error) => set({ status: "failed", lastError: error }),
}));
