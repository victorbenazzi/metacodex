import { create } from "zustand";

export type ExternalState = "clean" | "changed" | "deleted";

interface TabEditorState {
  dirty: boolean;
  loadedContent: string | null;
  /** True while we're persisting via write_file_text. */
  saving: boolean;
  /** Whether the file diverged on disk underneath this open buffer. */
  externalState: ExternalState;
  /** Fresh disk content awaiting application to the live EditorView. */
  pendingContent: string | null;
  /** Bumped to signal the EditorTab to apply `pendingContent` to its view. */
  reloadNonce: number;
}

interface EditorState {
  byTab: Record<string, TabEditorState>;
  /** Buffer now matches disk with this content (initial load, save, or reload). */
  setLoaded: (tabId: string, content: string) => void;
  setDirty: (tabId: string, dirty: boolean) => void;
  setSaving: (tabId: string, saving: boolean) => void;
  /** Disk changed under a CLEAN buffer — apply silently. */
  requestReload: (tabId: string, content: string) => void;
  /** Disk changed under a DIRTY buffer — surface a conflict banner. */
  flagExternalChange: (tabId: string, content: string) => void;
  /** File removed on disk under an open buffer. */
  flagExternalDelete: (tabId: string) => void;
  /** Conflict banner "Recarregar": apply the stashed pendingContent. */
  confirmReload: (tabId: string) => void;
  /** Conflict banner "Manter o meu"/"Manter aberto": drop the external flag. */
  dismissExternal: (tabId: string) => void;
  remove: (tabId: string) => void;
  get: (tabId: string) => TabEditorState | undefined;
}

const cleanState = (content: string, reloadNonce: number): TabEditorState => ({
  dirty: false,
  loadedContent: content,
  saving: false,
  externalState: "clean",
  pendingContent: null,
  reloadNonce,
});

export const useEditorStore = create<EditorState>((set, getStore) => ({
  byTab: {},
  setLoaded: (tabId, content) =>
    set((s) => ({
      // Preserve reloadNonce so applying a reload doesn't re-trigger itself.
      byTab: { ...s.byTab, [tabId]: cleanState(content, s.byTab[tabId]?.reloadNonce ?? 0) },
    })),
  setDirty: (tabId, dirty) =>
    set((s) => {
      const cur = s.byTab[tabId];
      if (!cur || cur.dirty === dirty) return s;
      return { byTab: { ...s.byTab, [tabId]: { ...cur, dirty } } };
    }),
  setSaving: (tabId, saving) =>
    set((s) => {
      const cur = s.byTab[tabId];
      if (!cur) return s;
      return { byTab: { ...s.byTab, [tabId]: { ...cur, saving } } };
    }),
  requestReload: (tabId, content) =>
    set((s) => {
      const cur = s.byTab[tabId];
      if (!cur) return s;
      return {
        byTab: {
          ...s.byTab,
          [tabId]: {
            ...cur,
            externalState: "clean",
            pendingContent: content,
            reloadNonce: cur.reloadNonce + 1,
          },
        },
      };
    }),
  flagExternalChange: (tabId, content) =>
    set((s) => {
      const cur = s.byTab[tabId];
      if (!cur) return s;
      return {
        byTab: {
          ...s.byTab,
          [tabId]: { ...cur, externalState: "changed", pendingContent: content },
        },
      };
    }),
  flagExternalDelete: (tabId) =>
    set((s) => {
      const cur = s.byTab[tabId];
      if (!cur) return s;
      return {
        byTab: { ...s.byTab, [tabId]: { ...cur, externalState: "deleted", pendingContent: null } },
      };
    }),
  confirmReload: (tabId) =>
    set((s) => {
      const cur = s.byTab[tabId];
      if (!cur || cur.pendingContent == null) return s;
      return {
        byTab: {
          ...s.byTab,
          [tabId]: { ...cur, externalState: "clean", reloadNonce: cur.reloadNonce + 1 },
        },
      };
    }),
  dismissExternal: (tabId) =>
    set((s) => {
      const cur = s.byTab[tabId];
      if (!cur) return s;
      return {
        byTab: { ...s.byTab, [tabId]: { ...cur, externalState: "clean", pendingContent: null } },
      };
    }),
  remove: (tabId) =>
    set((s) => {
      const { [tabId]: _, ...rest } = s.byTab;
      return { byTab: rest };
    }),
  get: (tabId) => getStore().byTab[tabId],
}));
