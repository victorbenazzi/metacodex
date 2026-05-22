import { create } from "zustand";

/**
 * Live cursor / selection readout per editor tab, fed by a CodeMirror
 * updateListener and consumed only by the status bar. Kept separate from
 * `editor.store` so cursor movement re-renders the tiny status bar, not the
 * whole EditorTab.
 */
export interface CursorStatus {
  line: number;
  col: number;
  /** Total selected characters across all ranges (0 when nothing selected). */
  selChars: number;
  /** Number of selection ranges (cursors). >1 means multi-cursor. */
  ranges: number;
  /** Enclosing code scope names at the cursor, outermost first (breadcrumbs). */
  crumbs: string[];
}

interface EditorStatusState {
  byTab: Record<string, CursorStatus>;
  setStatus: (tabId: string, status: CursorStatus) => void;
  clear: (tabId: string) => void;
}

export const useEditorStatusStore = create<EditorStatusState>((set) => ({
  byTab: {},
  setStatus: (tabId, status) =>
    set((s) => {
      const cur = s.byTab[tabId];
      if (
        cur &&
        cur.line === status.line &&
        cur.col === status.col &&
        cur.selChars === status.selChars &&
        cur.ranges === status.ranges &&
        cur.crumbs.length === status.crumbs.length &&
        cur.crumbs.every((c, i) => c === status.crumbs[i])
      ) {
        return s; // no change — avoid a needless re-render
      }
      return { byTab: { ...s.byTab, [tabId]: status } };
    }),
  clear: (tabId) =>
    set((s) => {
      const { [tabId]: _, ...rest } = s.byTab;
      return { byTab: rest };
    }),
}));
