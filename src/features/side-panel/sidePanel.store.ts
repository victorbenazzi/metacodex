import { create } from "zustand";

/**
 * Right workbench: open surface tabs (Changes / Files) plus whether the
 * panel is focused on a surface or on a document tab from the editor.
 * `view === "closed"` hides the column; `openTabs` remembers what was showing.
 *
 * `shellFocus` is which column owns Cmd+W / Ctrl+Tab. The workbench can be
 * open (Changes visible) while the keyboard still targets the center process.
 */
export type RightWorkbenchTab = "changes" | "files" | "browser";
export type SidePanelView = "closed" | RightWorkbenchTab;
export type WorkbenchFocus = "surface" | "doc";
export type ShellFocus = "center" | "workbench";

export const WORKBENCH_SURFACES: RightWorkbenchTab[] = ["changes", "files", "browser"];

interface SidePanelState {
  view: SidePanelView;
  openTabs: RightWorkbenchTab[];
  focus: WorkbenchFocus;
  /** Last document shown in the workbench; survives switching the center agent. */
  activeDocId: string | null;
  /** Which column last received pointer focus. Keyboard close/cycle read this. */
  shellFocus: ShellFocus;
  toggle: () => void;
  close: () => void;
  show: (tab: RightWorkbenchTab) => void;
  closeTab: (tab: RightWorkbenchTab) => void;
  moveTab: (id: RightWorkbenchTab, toIndex: number) => void;
  focusDoc: (id?: string) => void;
  setShellFocus: (shellFocus: ShellFocus) => void;
}

function ensureOpen(
  openTabs: RightWorkbenchTab[],
  tab: RightWorkbenchTab,
): RightWorkbenchTab[] {
  return openTabs.includes(tab) ? openTabs : [...openTabs, tab];
}

export function workbenchOwnsKeyboard(state: {
  view: SidePanelView;
  shellFocus: ShellFocus;
}): boolean {
  return state.view !== "closed" && state.shellFocus === "workbench";
}

export const useSidePanelStore = create<SidePanelState>((set) => ({
  view: "changes",
  openTabs: ["changes"],
  focus: "surface",
  activeDocId: null,
  shellFocus: "center",
  toggle: () =>
    set((s) => {
      if (s.view !== "closed") {
        return { view: "closed", shellFocus: "center" };
      }
      const next = s.openTabs[0] ?? "changes";
      return {
        view: next,
        openTabs: s.openTabs.length > 0 ? s.openTabs : [next],
        focus: "surface",
        shellFocus: "workbench",
      };
    }),
  close: () => set({ view: "closed", shellFocus: "center" }),
  show: (tab) =>
    set((s) => ({
      view: tab,
      openTabs: ensureOpen(s.openTabs, tab),
      focus: "surface",
      shellFocus: "workbench",
    })),
  closeTab: (tab) =>
    set((s) => {
      const openTabs = s.openTabs.filter((item) => item !== tab);
      if (openTabs.length === 0) {
        return { view: "closed", openTabs: [], focus: "surface", shellFocus: "center" };
      }
      const view =
        s.view === tab || s.view === "closed" ? openTabs[openTabs.length - 1] : s.view;
      return { openTabs, view, focus: "surface" };
    }),
  moveTab: (id, toIndex) =>
    set((s) => {
      const from = s.openTabs.indexOf(id);
      if (from < 0) return s;
      const next = s.openTabs.slice();
      next.splice(from, 1);
      const clamped = Math.max(0, Math.min(next.length, toIndex));
      next.splice(clamped, 0, id);
      return { openTabs: next };
    }),
  focusDoc: (id) =>
    set((s) => ({
      view: s.view === "closed" ? "files" : s.view,
      openTabs: s.view === "closed" && s.openTabs.length === 0 ? ["files"] : s.openTabs,
      focus: "doc",
      activeDocId: id ?? s.activeDocId,
      shellFocus: "workbench",
    })),
  setShellFocus: (shellFocus) => set({ shellFocus }),
}));
