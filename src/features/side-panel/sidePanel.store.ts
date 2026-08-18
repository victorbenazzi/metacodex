import { create } from "zustand";

/**
 * Right workbench: open surface tabs (Changes / Files / Browser) plus whether
 * the panel is focused on a surface or on a document tab from the editor.
 * `view === "closed"` hides the column; `openTabs` remembers what was showing.
 */
export type RightWorkbenchTab = "changes" | "files" | "browser";
export type SidePanelView = "closed" | RightWorkbenchTab;
export type WorkbenchFocus = "surface" | "doc";

export const WORKBENCH_SURFACES: RightWorkbenchTab[] = ["changes", "files", "browser"];

interface SidePanelState {
  view: SidePanelView;
  openTabs: RightWorkbenchTab[];
  focus: WorkbenchFocus;
  /** Last document shown in the workbench; survives switching the center agent. */
  activeDocId: string | null;
  toggle: () => void;
  close: () => void;
  show: (tab: RightWorkbenchTab) => void;
  closeTab: (tab: RightWorkbenchTab) => void;
  moveTab: (id: RightWorkbenchTab, toIndex: number) => void;
  focusDoc: (id?: string) => void;
  /** @deprecated Use `show("changes")`. Kept so older call sites keep compiling. */
  showReview: () => void;
  /** @deprecated Launcher moved to the New Agent modal. Opens Changes. */
  showLauncher: () => void;
}

function ensureOpen(
  openTabs: RightWorkbenchTab[],
  tab: RightWorkbenchTab,
): RightWorkbenchTab[] {
  return openTabs.includes(tab) ? openTabs : [...openTabs, tab];
}

export const useSidePanelStore = create<SidePanelState>((set) => ({
  view: "changes",
  openTabs: ["changes"],
  focus: "surface",
  activeDocId: null,
  toggle: () =>
    set((s) => {
      if (s.view !== "closed") return { view: "closed" };
      const next = s.openTabs[0] ?? "changes";
      return {
        view: next,
        openTabs: s.openTabs.length > 0 ? s.openTabs : [next],
        focus: "surface",
      };
    }),
  close: () => set({ view: "closed" }),
  show: (tab) =>
    set((s) => ({
      view: tab,
      openTabs: ensureOpen(s.openTabs, tab),
      focus: "surface",
    })),
  closeTab: (tab) =>
    set((s) => {
      const openTabs = s.openTabs.filter((item) => item !== tab);
      if (openTabs.length === 0) return { view: "closed", openTabs: [], focus: "surface" };
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
    })),
  showReview: () =>
    set((s) => ({
      view: "changes",
      openTabs: ensureOpen(s.openTabs, "changes"),
      focus: "surface",
    })),
  showLauncher: () =>
    set((s) => ({
      view: "changes",
      openTabs: ensureOpen(s.openTabs, "changes"),
      focus: "surface",
    })),
}));
