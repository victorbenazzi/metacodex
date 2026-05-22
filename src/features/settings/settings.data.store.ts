import { create } from "zustand";

import i18n, { isLanguageId, type LanguageId } from "@/features/i18n/config";
import { useThemeStore, type ThemeMode } from "@/features/theme/theme.store";

import { settingsApi } from "./settings.service";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type AppSettings,
  type SettingsSliceKey,
} from "./settings.types";

interface SettingsDataState {
  /** Always fully-populated (seeded from DEFAULT_SETTINGS) so consumers can read
   *  it before hydration completes. */
  settings: AppSettings;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  /** Patch a nested slice (editor / terminal / performance). */
  update: <K extends SettingsSliceKey>(key: K, patch: Partial<AppSettings[K]>) => void;
  /** Mirror theme/language changes that originate in the theme/i18n stores. */
  setTheme: (mode: ThemeMode) => void;
  setLanguage: (id: LanguageId) => void;
}

const PERSIST_DEBOUNCE_MS = 400;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(read: () => AppSettings) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    settingsApi.write(read()).catch((err) => console.error("[settings] persist failed", err));
  }, PERSIST_DEBOUNCE_MS);
}

export const useSettingsDataStore = create<SettingsDataState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await settingsApi.read();
      const merged = mergeSettings(raw);

      // First run after upgrade: if settings.json didn't carry theme/language
      // yet, seed them from the synchronous localStorage-backed stores so the
      // user's existing choice survives into the new file. (Orthogonal to the
      // "start clean" decision, which was only about projects/workspace state.)
      const rawObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      if (!("theme" in rawObj)) merged.theme = useThemeStore.getState().mode;
      if (!("language" in rawObj) && isLanguageId(i18n.language)) merged.language = i18n.language;

      set({ settings: merged, hydrated: true });

      // settings.json is now authoritative — reconcile the live stores to it once.
      if (useThemeStore.getState().mode !== merged.theme) {
        useThemeStore.getState().setMode(merged.theme);
      }
      if (i18n.language !== merged.language) {
        void i18n.changeLanguage(merged.language);
      }
    } catch (err) {
      console.error("[settings] hydrate failed", err);
      set({ hydrated: true });
    }
  },

  update: (key, patch) => {
    const cur = get().settings;
    const slice = { ...(cur[key] as object), ...(patch as object) };
    set({ settings: { ...cur, [key]: slice } as AppSettings });
    if (get().hydrated) schedulePersist(() => get().settings);
  },

  setTheme: (mode) => {
    if (get().settings.theme === mode) return;
    set({ settings: { ...get().settings, theme: mode } });
    if (get().hydrated) schedulePersist(() => get().settings);
  },

  setLanguage: (id) => {
    if (get().settings.language === id) return;
    set({ settings: { ...get().settings, language: id } });
    if (get().hydrated) schedulePersist(() => get().settings);
  },
}));

// One-way bridges: this store observes the theme/i18n stores and persists their
// changes into settings.json. The theme/i18n modules know nothing about settings
// (they keep driving the document + their localStorage paint-cache), so there is
// no import cycle. Registered once at module load.
useThemeStore.subscribe((s) => {
  useSettingsDataStore.getState().setTheme(s.mode);
});
i18n.on("languageChanged", (lng) => {
  if (isLanguageId(lng)) useSettingsDataStore.getState().setLanguage(lng);
});
