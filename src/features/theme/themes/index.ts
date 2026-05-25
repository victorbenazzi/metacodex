import type { Theme, ThemeKind } from "../types";

import { catppuccinMocha } from "./catppuccinMocha";
import { githubDark } from "./githubDark";
import { githubLight } from "./githubLight";
import { monoSlate } from "./monoSlate";
import { oneDark } from "./oneDark";
import { paper } from "./paper";
import { solarCream } from "./solarCream";
import { solarizedLight } from "./solarizedLight";
import { tokyoNight } from "./tokyoNight";

/** Built-in theme registry. Order here is the order they appear in the picker. */
export const THEMES: Theme[] = [
  solarCream,
  paper,
  githubLight,
  solarizedLight,
  monoSlate,
  tokyoNight,
  oneDark,
  githubDark,
  catppuccinMocha,
];

const BY_ID: Record<string, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

export const DEFAULT_LIGHT_THEME_ID = solarCream.id;
export const DEFAULT_DARK_THEME_ID = monoSlate.id;

export function isThemeId(id: unknown): id is string {
  return typeof id === "string" && id in BY_ID;
}

/** Lookup with a safe fallback to the default light theme. */
export function getTheme(id: string | null | undefined): Theme {
  if (id && id in BY_ID) return BY_ID[id]!;
  return BY_ID[DEFAULT_LIGHT_THEME_ID]!;
}

/** Default theme for a given kind. Used when toggling Mode resets to a baseline. */
export function defaultThemeForKind(kind: ThemeKind): Theme {
  return kind === "dark" ? BY_ID[DEFAULT_DARK_THEME_ID]! : BY_ID[DEFAULT_LIGHT_THEME_ID]!;
}

export function themesByKind(kind: ThemeKind): Theme[] {
  return THEMES.filter((t) => t.kind === kind);
}
