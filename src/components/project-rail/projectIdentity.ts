import * as Lucide from "lucide-react";

/**
 * Shared project-identity helpers used wherever a project renders its mark:
 * the rail tile (`ProjectTile`) and the sidebar-row glyph (`ProjectGlyph`).
 * Kept here so the monogram/icon rules have one home and can't drift between
 * the two render sites (the JSX differs by scale; this logic does not).
 */

/** Resolve a Lucide icon name to its component. Returns null when the name
 *  doesn't match, so the caller falls through to the typographic monogram. */
export function lookupLucide(name: string): Lucide.LucideIcon | null {
  const I = (Lucide as unknown as Record<string, Lucide.LucideIcon>)[name];
  return I ?? null;
}

/** Initials shown when a project has no chosen icon. Two-word names take one
 *  letter per word; single-word names take just the first letter (the
 *  single-letter look is the editorial default). */
export function monogram(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "·";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words[0] && words[1]) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return cleaned.slice(0, 1).toUpperCase();
}
