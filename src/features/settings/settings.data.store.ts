import { create } from "zustand";

import i18n, { isLanguageId, type LanguageId } from "@/features/i18n/config";
import { recordDiag } from "@/features/diagnostics/diagnostics.store";
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
  setThemeId: (id: string) => void;
  setLanguage: (id: LanguageId) => void;
}

const PERSIST_DEBOUNCE_MS = 400;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let settingsRevision = 0;
let persistedRevision = 0;
let persistInFlight: Promise<void> = Promise.resolve();

function errorDetail(err: unknown): Record<string, unknown> {
  return { error: err instanceof Error ? err.message : String(err) };
}

function persistSnapshot(settings: AppSettings, revision: number): Promise<void> {
  const operation = persistInFlight.catch(() => undefined).then(async () => {
    try {
      await settingsApi.write(settings);
      persistedRevision = Math.max(persistedRevision, revision);
    } catch (err) {
      recordDiag("settings.save.fail", { detail: { area: "settings", ...errorDetail(err) } });
      throw err;
    }
  });
  persistInFlight = operation;
  return operation;
}

function schedulePersist(read: () => AppSettings) {
  settingsRevision += 1;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const revision = settingsRevision;
    void persistSnapshot(read(), revision).catch((err) => {
      console.error("[settings] persist failed", err);
    });
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Persist pending settings immediately, cancelling the debounce. Called by the
 * quit handshake so a preference changed within the 400ms window (e.g. a panel
 * width drag) isn't lost when the app exits. Safe to call when nothing's
 * pending (writes the current settings, which is a no-op on disk content).
 */
export async function flushSettings(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistInFlight.catch(() => undefined);
  if (persistedRevision >= settingsRevision && settingsRevision > 0) return;

  const revision = settingsRevision;
  await persistSnapshot(useSettingsDataStore.getState().settings, revision).catch((err) => {
    console.error("[settings] flush failed", err);
    throw err;
  });
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
      if (!("themeId" in rawObj)) merged.themeId = useThemeStore.getState().theme.id;
      if (!("language" in rawObj) && isLanguageId(i18n.language)) merged.language = i18n.language;

      set({ settings: merged, hydrated: true });

      // settings.json is now authoritative for Mode (system / light / dark).
      // The palette (Porcelain vs Graphite) is derived from that mode; leftover
      // gallery ids are collapsed in mergeSettings and ignored here.
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
    // Run the merged candidate through mergeSettings so any out-of-range or
    // wrong-typed value gets clamped on the way in. Before this guard the
    // store accepted e.g. scrollback=-1 or workspaceSaveDebounceMs=1e9 and
    // only clamped them at the next hydrate — confusing for the user.
    const next = mergeSettings({ ...cur, [key]: slice });
    set({ settings: next });
    if (get().hydrated) schedulePersist(() => get().settings);
  },

  setTheme: (mode) => {
    if (get().settings.theme === mode) return;
    set({ settings: { ...get().settings, theme: mode } });
    if (get().hydrated) schedulePersist(() => get().settings);
  },

  setThemeId: (id) => {
    if (get().settings.themeId === id) return;
    set({ settings: { ...get().settings, themeId: id } });
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
  const d = useSettingsDataStore.getState();
  d.setTheme(s.mode);
  d.setThemeId(s.theme.id);
});
i18n.on("languageChanged", (lng) => {
  if (isLanguageId(lng)) useSettingsDataStore.getState().setLanguage(lng);
});
