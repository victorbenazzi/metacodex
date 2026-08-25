import { create } from "zustand";

import { applyTheme } from "./applyTheme";
import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  defaultThemeForKind,
} from "./themes";
import type { Theme } from "./types";

export type ThemeMode = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

interface ThemeState {
  /** User-chosen light/dark preference (or "system" to follow the OS). */
  mode: ThemeMode;
  /** Active palette. Always Porcelain (light) or Graphite (dark). */
  theme: Theme;
  /** Resolved kind currently applied to the document. */
  effective: EffectiveTheme;

  setMode: (mode: ThemeMode) => void;
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

function writeStored(mode: ThemeMode, themeId: string) {
  try {
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(THEME_ID_KEY, themeId);
  } catch {
    // ignore
  }
}

// Collapse any leftover gallery id (Tokyo Night, Solar Cream, …) onto the
// Porcelain / Graphite pair. Mode stays authoritative: System still follows
// the OS, Light/Dark stay locked. Stamped via THEME_REV so it runs once.
const THEME_REV_KEY = "metacodex:themeRev";
const THEME_REV = "pair-1";
function migrateToPair() {
  try {
    if (localStorage.getItem(THEME_REV_KEY) === THEME_REV) return;
    const mode = readStoredMode();
    const effective = resolveEffective(mode);
    localStorage.setItem(
      THEME_ID_KEY,
      effective === "dark" ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID,
    );
    localStorage.setItem(THEME_REV_KEY, THEME_REV);
  } catch {
    // localStorage may be unavailable; the new defaults still apply for fresh state
  }
}
migrateToPair();

// First-paint resolution: mode (System / Light / Dark) picks Porcelain or
// Graphite. This runs synchronously at module load so the cascade is correct
// before React mounts — no FOUC.
const initialMode = readStoredMode();
const initialEffective = resolveEffective(initialMode);
const initialTheme: Theme = defaultThemeForKind(initialEffective);
applyTheme(initialTheme);

function applyMode(mode: ThemeMode): { theme: Theme; effective: EffectiveTheme } {
  const effective = resolveEffective(mode);
  const theme = defaultThemeForKind(effective);
  applyTheme(theme);
  writeStored(mode, theme.id);
  return { theme, effective };
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode,
  theme: initialTheme,
  effective: initialEffective,

  setMode: (mode) => {
    const { theme, effective } = applyMode(mode);
    set({ mode, theme, effective });
  },

  refresh: () => {
    const state = get();
    if (state.mode !== "system") return;
    const effective = readSystemTheme();
    if (effective === state.effective) return;
    const theme = defaultThemeForKind(effective);
    applyTheme(theme);
    writeStored(state.mode, theme.id);
    set({ theme, effective });
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
