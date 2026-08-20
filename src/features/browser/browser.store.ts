import { create } from "zustand";

import type { BrowserMode } from "./browser.service";

interface BrowserUiState {
  /** Loaded page URL. Null means the start page (native webview hidden). */
  url: string | null;
  title: string;
  address: string;
  mode: BrowserMode;
  loading: boolean;
  /** Full-width overlay; only applied while the Browser surface is visible. */
  expanded: boolean;
  setUrl: (url: string | null, title?: string) => void;
  setAddress: (address: string) => void;
  setMode: (mode: BrowserMode) => void;
  setLoading: (loading: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;
}

export const useBrowserUiStore = create<BrowserUiState>((set) => ({
  url: null,
  title: "",
  address: "",
  mode: "browse",
  loading: false,
  expanded: false,
  setUrl: (url, title) =>
    set((s) => ({
      url,
      title: title ?? s.title,
      address: url ?? s.address,
      mode: url ? s.mode : "browse",
      loading: url ? s.loading : false,
    })),
  setAddress: (address) => set({ address }),
  setMode: (mode) => set({ mode }),
  setLoading: (loading) => set({ loading }),
  setExpanded: (expanded) => set({ expanded }),
  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
}));
