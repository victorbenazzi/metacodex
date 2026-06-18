import { getPaletteEntry } from "./project.types";

/**
 * Color helpers for the project rail.
 *
 * The user picks one accent (`project.color`, a hex from the light-theme
 * canonical column of `PROJECT_PALETTE`). At render time we derive both the
 * icon stroke and the translucent tile background from that hex *and* the
 * current effective theme.
 *
 * Strategy:
 *   - Light theme: use the canonical hex directly for the icon, with bolder
 *     background alpha (the cream canvas swallows subtle tints, so we lean
 *     in a bit).
 *   - Dark theme: look up the pre-baked dark variant from the palette so the
 *     hue stays vivid without manual derivation. If we don't have a match
 *     (legacy projects with hex strings outside the current palette), we lift
 *     32% toward white as a programmatic fallback.
 */
export type EffectiveTheme = "light" | "dark";

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  const n = parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Resolve the hex value to use for the icon stroke in the given theme.
 * Light theme always returns the canonical hex. Dark theme prefers the
 * pre-baked `dark` variant from the palette; if absent, lifts the canonical
 * hex 32% toward white.
 */
export function tileIconColor(hex: string, theme: EffectiveTheme): string {
  if (theme === "light") return hex;
  const entry = getPaletteEntry(hex);
  if (entry) return entry.dark;
  // Legacy fallback — keep old projects readable even after a palette refresh.
  const [r, g, b] = hexToRgb(hex);
  const lift = (c: number) => Math.round(c + (255 - c) * 0.32);
  return `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`;
}

/** Translucent tile fill — denser when active or hovered. */
export function tileBackground(
  hex: string,
  opts: { theme: EffectiveTheme; active: boolean; hover?: boolean },
): string {
  const baseHex = opts.theme === "dark" ? tileIconColor(hex, "dark") : hex;
  const isDark = opts.theme === "dark";
  let alpha: number;
  if (opts.active) alpha = isDark ? 0.36 : 0.42;
  else if (opts.hover) alpha = isDark ? 0.26 : 0.30;
  else alpha = isDark ? 0.18 : 0.20;
  return rgba(baseHex, alpha);
}

/**
 * Softer fill for tiles that show a favicon image — the project's accent still
 * tints the cell, but quietly enough that the favicon's own colors don't fight
 * with it.
 */
export function tileBackgroundFavicon(
  hex: string,
  opts: { theme: EffectiveTheme; active: boolean; hover?: boolean },
): string {
  const baseHex = opts.theme === "dark" ? tileIconColor(hex, "dark") : hex;
  const isDark = opts.theme === "dark";
  let alpha: number;
  if (opts.active) alpha = isDark ? 0.20 : 0.22;
  else if (opts.hover) alpha = isDark ? 0.14 : 0.14;
  else alpha = isDark ? 0.08 : 0.08;
  return rgba(baseHex, alpha);
}
