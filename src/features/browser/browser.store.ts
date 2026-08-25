import { create } from "zustand";

import type { BrowserContextDetail, BrowserMode } from "./browser.service";

interface BrowserUiState {
  /** Loaded page URL. Null means the start page (native webview hidden). */
  url: string | null;
  title: string;
  address: string;
  mode: BrowserMode;
  contextDetail: BrowserContextDetail;
  loading: boolean;
  /** Full-width overlay; only applied while the Browser surface is visible. */
  expanded: boolean;
  setUrl: (url: string | null, title?: string) => void;
  setAddress: (address: string) => void;
  setMode: (mode: BrowserMode) => void;
  setContextDetail: (detail: BrowserContextDetail) => void;
  setLoading: (loading: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;
}

export const useBrowserUiStore = create<BrowserUiState>((set) => ({
  url: null,
  title: "",
  address: "",
  mode: "browse",
  contextDetail: "compact",
  loading: false,
  expanded: false,
  setUrl: (url, title) =>
    set((s) => ({
      url,
      title: title ?? s.title,
      address: url ?? s.address,
      loading: url ? s.loading : false,
    })),
  setAddress: (address) => set({ address }),
  setMode: (mode) => set({ mode }),
  setContextDetail: (contextDetail) => set({ contextDetail }),
  setLoading: (loading) => set({ loading }),
  setExpanded: (expanded) => set({ expanded }),
  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
}));
