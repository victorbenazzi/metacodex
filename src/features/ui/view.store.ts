import { create } from "zustand";

/**
 * Top-level view of the app. `code` is the original VS Code-style workspace
 * (explorer + terminal/CLI tabs); `agent` is the Agent View (chat + agent
 * orchestration over the opencode runtime). Switched from the titlebar toggle.
 */
export type ViewMode = "code" | "agent";

const VIEW_KEY = "metacodex:view";

function readStoredView(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "code" || v === "agent") return v;
  } catch {
    // localStorage may be unavailable in some contexts; fall through
  }
  return "code";
}

function writeStoredView(view: ViewMode) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // ignore
  }
}

interface ViewState {
  view: ViewMode;
  setView: (view: ViewMode) => void;
  toggleView: () => void;
}

// localStorage is the durable store for the view choice: unlike theme, this is
// transient navigation state, not a showcased preference, so it stays out of
// settings.json. The synchronous read at module load avoids a flash of the
// wrong view on boot.
export const useViewStore = create<ViewState>((set, get) => ({
  view: readStoredView(),
  setView: (view) => {
    if (get().view === view) return;
    writeStoredView(view);
    set({ view });
  },
  toggleView: () => get().setView(get().view === "code" ? "agent" : "code"),
}));
