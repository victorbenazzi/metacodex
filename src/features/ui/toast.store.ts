import { create } from "zustand";

import { newId } from "@/lib/idGen";

export type ToastTone = "info" | "error" | "success";

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  /** Optional secondary line (e.g. an error detail / path). */
  detail?: string;
  /** Auto-dismiss after this many ms. 0 = sticky (user dismisses). */
  durationMs: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "durationMs"> & { durationMs?: number }) => string;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION: Record<ToastTone, number> = {
  info: 4000,
  success: 3000,
  error: 0, // errors stick until dismissed — they usually need reading
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: ({ tone, title, detail, durationMs }) => {
    const id = newId(8);
    set((s) => ({
      toasts: [...s.toasts, { id, tone, title, detail, durationMs: durationMs ?? DEFAULT_DURATION[tone] }],
    }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helpers for non-React call sites (stores, services). */
export const toast = {
  info: (title: string, detail?: string) => useToastStore.getState().push({ tone: "info", title, detail }),
  error: (title: string, detail?: string) => useToastStore.getState().push({ tone: "error", title, detail }),
  success: (title: string, detail?: string) =>
    useToastStore.getState().push({ tone: "success", title, detail }),
};
