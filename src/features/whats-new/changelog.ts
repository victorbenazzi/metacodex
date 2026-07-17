import { Palette, RefreshCw, Sparkles, type IconComponent } from "@/components/ui/icons";

/** One highlight row in the post-update dialog. Copy lives in i18n (both
 *  locales); this file only wires structure, icons and ordering. */
export interface ChangelogHighlight {
  icon: IconComponent;
  titleKey: string;
  bodyKey: string;
}

export interface ChangelogEntry {
  /** App version this entry describes; must match the release tag (v{version}). */
  version: string;
  /** i18n key for the dialog headline. */
  titleKey: string;
  highlights: ChangelogHighlight[];
}

/** GitHub release page for a given app version (tags are `v{version}`). */
export function githubReleaseUrl(version: string): string {
  return `https://github.com/victorbenazzi/metacodex/releases/tag/v${version}`;
}

/**
 * Newest first. Add an entry here when cutting a release worth announcing;
 * releases without an entry update silently (the boot check just marks the
 * version as seen). Keys must exist in BOTH locale JSONs under `whatsNew`.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.0.18",
    titleKey: "whatsNew.r0018.title",
    highlights: [
      {
        icon: Palette,
        titleKey: "whatsNew.r0018.identityTitle",
        bodyKey: "whatsNew.r0018.identityBody",
      },
      {
        icon: RefreshCw,
        titleKey: "whatsNew.r0018.explorerTitle",
        bodyKey: "whatsNew.r0018.explorerBody",
      },
      {
        icon: Sparkles,
        titleKey: "whatsNew.r0018.notesTitle",
        bodyKey: "whatsNew.r0018.notesBody",
      },
    ],
  },
];

/**
 * Numeric dotted-version compare (`0.0.9` < `0.0.10`). Returns <0, 0 or >0.
 * Missing segments count as 0 (`1.2` == `1.2.0`).
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Newest entry that the running app version already includes (entry version
 *  <= current). Skips future entries sitting in the file before release. */
export function latestEntryFor(currentVersion: string): ChangelogEntry | null {
  for (const entry of CHANGELOG) {
    if (compareVersions(entry.version, currentVersion) <= 0) return entry;
  }
  return null;
}
