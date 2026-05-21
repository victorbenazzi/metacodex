import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

interface ThemeState {
  mode: ThemeMode;
  effective: EffectiveTheme;
  setMode: (mode: ThemeMode) => void;
  /** Recompute the effective theme from the current OS preference. */
  refresh: () => void;
}

function readSystemTheme(): EffectiveTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveEffective(mode: ThemeMode): EffectiveTheme {
  return mode === "system" ? readSystemTheme() : mode;
}

function applyToDocument(effective: EffectiveTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", effective);
  document.documentElement.style.colorScheme = effective;
}

const STORAGE_KEY = "metacodex:theme";
function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // localStorage may be unavailable in some contexts; fall through
  }
  return "system";
}
function writeStored(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

const initialMode = readStored();
const initialEffective = resolveEffective(initialMode);
applyToDocument(initialEffective);

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode,
  effective: initialEffective,
  setMode: (mode) => {
    const effective = resolveEffective(mode);
    applyToDocument(effective);
    writeStored(mode);
    set({ mode, effective });
  },
  refresh: () => {
    const eff = resolveEffective(get().mode);
    if (eff !== get().effective) {
      applyToDocument(eff);
      set({ effective: eff });
    }
  },
}));

/** Wire OS theme listener once at startup. */
export function initThemeListener() {
  if (typeof window === "undefined" || !window.matchMedia) return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => useThemeStore.getState().refresh();
  // Modern + legacy listener for Safari < 14
  if (mq.addEventListener) mq.addEventListener("change", handler);
  else mq.addListener(handler);
}
