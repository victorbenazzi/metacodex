import { create } from "zustand";

import { applyTheme } from "./applyTheme";
import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  defaultThemeForKind,
  getTheme,
  isThemeId,
} from "./themes";
import type { Theme } from "./types";

export type ThemeMode = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

interface ThemeState {
  /** User-chosen light/dark preference (or "system" to follow the OS). */
  mode: ThemeMode;
  /** Active palette. Determines `effective` via `theme.kind`. */
  theme: Theme;
  /** Resolved kind currently applied to the document. Mirrors `theme.kind`. */
  effective: EffectiveTheme;

  setMode: (mode: ThemeMode) => void;
  /** Pick a specific palette. Mode is synchronised to the theme's kind so the
   *  picker selection and the Light/Dark toggle never disagree. */
  setThemeId: (id: string) => void;
  /** Recompute the effective theme from the current OS preference (no-op when
   *  mode is "light" or "dark"). */
  refresh: () => void;
}

function readSystemTheme(): EffectiveTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveEffective(mode: ThemeMode): EffectiveTheme {
  return mode === "system" ? readSystemTheme() : mode;
}

const MODE_KEY = "metacodex:theme";
const THEME_ID_KEY = "metacodex:themeId";

function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // localStorage may be unavailable in some contexts; fall through
  }
  return "system";
}

function readStoredThemeId(): string | null {
  try {
    const v = localStorage.getItem(THEME_ID_KEY);
    return isThemeId(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStored(mode: ThemeMode, themeId: string) {
  try {
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(THEME_ID_KEY, themeId);
  } catch {
    // ignore
  }
}

// First-paint resolution: pick the stored themeId if any, otherwise derive
// from the stored mode (falling back to OS). This runs synchronously at module
// load so the cascade is correct before React mounts — no FOUC.
const initialMode = readStoredMode();
const storedThemeId = readStoredThemeId();
const initialEffective = resolveEffective(initialMode);
const initialTheme: Theme = storedThemeId
  ? getTheme(storedThemeId)
  : defaultThemeForKind(initialEffective);
applyTheme(initialTheme);

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode,
  theme: initialTheme,
  effective: initialTheme.kind,

  setMode: (mode) => {
    const effective = resolveEffective(mode);
    // Switching mode resets to the baseline theme for that kind. If you want
    // to keep an exotic palette you re-pick it from the theme grid.
    const nextTheme = defaultThemeForKind(effective);
    applyTheme(nextTheme);
    writeStored(mode, nextTheme.id);
    set({ mode, theme: nextTheme, effective });
  },

  setThemeId: (id) => {
    const theme = getTheme(id);
    const mode: ThemeMode = theme.kind;
    applyTheme(theme);
    writeStored(mode, theme.id);
    set({ mode, theme, effective: theme.kind });
  },

  refresh: () => {
    const state = get();
    if (state.mode !== "system") return;
    const effective = readSystemTheme();
    if (effective === state.effective) return;
    const nextTheme = defaultThemeForKind(effective);
    applyTheme(nextTheme);
    writeStored(state.mode, nextTheme.id);
    set({ theme: nextTheme, effective });
  },
}));

/** Wire OS theme listener once at startup. */
export function initThemeListener() {
  if (typeof window === "undefined" || !window.matchMedia) return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => useThemeStore.getState().refresh();
  if (mq.addEventListener) mq.addEventListener("change", handler);
  else mq.addListener(handler);
}

// Export DEFAULT ids so settings can persist them safely.
export { DEFAULT_LIGHT_THEME_ID, DEFAULT_DARK_THEME_ID };
