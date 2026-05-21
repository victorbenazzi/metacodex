import { create } from "zustand";

interface TabEditorState {
  dirty: boolean;
  loadedContent: string | null;
  /** True while we're persisting via write_file_text. */
  saving: boolean;
}

interface EditorState {
  byTab: Record<string, TabEditorState>;
  setLoaded: (tabId: string, content: string) => void;
  setDirty: (tabId: string, dirty: boolean) => void;
  setSaving: (tabId: string, saving: boolean) => void;
  remove: (tabId: string) => void;
  get: (tabId: string) => TabEditorState | undefined;
}

export const useEditorStore = create<EditorState>((set, getStore) => ({
  byTab: {},
  setLoaded: (tabId, content) =>
    set((s) => ({
      byTab: {
        ...s.byTab,
        [tabId]: {
          dirty: false,
          loadedContent: content,
          saving: false,
        },
      },
    })),
  setDirty: (tabId, dirty) =>
    set((s) => {
      const cur = s.byTab[tabId];
      if (!cur) return s;
      if (cur.dirty === dirty) return s;
      return { byTab: { ...s.byTab, [tabId]: { ...cur, dirty } } };
    }),
  setSaving: (tabId, saving) =>
    set((s) => {
      const cur = s.byTab[tabId];
      if (!cur) return s;
      return { byTab: { ...s.byTab, [tabId]: { ...cur, saving } } };
    }),
  remove: (tabId) =>
    set((s) => {
      const { [tabId]: _, ...rest } = s.byTab;
      return { byTab: rest };
    }),
  get: (tabId) => getStore().byTab[tabId],
}));
