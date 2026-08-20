import type { Theme, ThemeKind } from "../types";

import { graphite } from "./graphite";
import { porcelain } from "./porcelain";

/** Built-in theme registry. Only the Cursor cream pair ships: Porcelain (light)
 *  and Graphite (dark). Extra palettes were retired so Appearance is just
 *  System / Light / Dark. */
export const THEMES: Theme[] = [porcelain, graphite];

const BY_ID: Record<string, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

export const DEFAULT_LIGHT_THEME_ID = porcelain.id;
export const DEFAULT_DARK_THEME_ID = graphite.id;

/** Ids that used to live in the gallery. Mapped to Porcelain / Graphite so
 *  settings.json and localStorage from older installs keep a matching kind. */
const LEGACY_THEME_KIND: Record<string, ThemeKind> = {
  "solar-cream": "light",
  paper: "light",
  "github-light": "light",
  "solarized-light": "light",
  "mono-slate": "dark",
  "tokyo-night": "dark",
  "one-dark": "dark",
  "github-dark": "dark",
  "catppuccin-mocha": "dark",
};

export function isThemeId(id: unknown): id is string {
  return typeof id === "string" && id in BY_ID;
}

export function kindForStoredThemeId(id: unknown): ThemeKind | null {
  if (typeof id !== "string") return null;
  if (id in BY_ID) return BY_ID[id]!.kind;
  return LEGACY_THEME_KIND[id] ?? null;
}

/** Lookup with a safe fallback to the default light theme. */
export function getTheme(id: string | null | undefined): Theme {
  if (id && id in BY_ID) return BY_ID[id]!;
  const legacy = id ? LEGACY_THEME_KIND[id] : undefined;
  if (legacy) return defaultThemeForKind(legacy);
  return BY_ID[DEFAULT_LIGHT_THEME_ID]!;
}

/** Default theme for a given kind. Used when toggling Mode. */
export function defaultThemeForKind(kind: ThemeKind): Theme {
  return kind === "dark" ? BY_ID[DEFAULT_DARK_THEME_ID]! : BY_ID[DEFAULT_LIGHT_THEME_ID]!;
}
