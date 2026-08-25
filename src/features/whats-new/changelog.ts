import {
  Bot,
  Globe,
  LayoutPanelLeft,
  Monitor,
  Palette,
  RefreshCw,
  Sparkles,
  Terminal,
  type IconComponent,
} from "@/components/ui/icons";

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
  /** Optional supporting copy for milestone releases. */
  summaryKey?: string;
  /** Milestones use the larger editorial presentation. */
  presentation?: "standard" | "milestone";
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
    version: "1.0.0",
    presentation: "milestone",
    titleKey: "whatsNew.r1000.title",
    summaryKey: "whatsNew.r1000.summary",
    highlights: [
      {
        icon: LayoutPanelLeft,
        titleKey: "whatsNew.r1000.workspaceTitle",
        bodyKey: "whatsNew.r1000.workspaceBody",
      },
      {
        icon: Terminal,
        titleKey: "whatsNew.r1000.runtimeTitle",
        bodyKey: "whatsNew.r1000.runtimeBody",
      },
      {
        icon: Globe,
        titleKey: "whatsNew.r1000.browserTitle",
        bodyKey: "whatsNew.r1000.browserBody",
      },
      {
        icon: Monitor,
        titleKey: "whatsNew.r1000.platformsTitle",
        bodyKey: "whatsNew.r1000.platformsBody",
      },
    ],
  },
  {
    version: "0.0.19",
    titleKey: "whatsNew.r0019.title",
    highlights: [
      {
        icon: Sparkles,
        titleKey: "whatsNew.r0019.launchTitle",
        bodyKey: "whatsNew.r0019.launchBody",
      },
      {
        icon: Bot,
        titleKey: "whatsNew.r0019.kimiTitle",
        bodyKey: "whatsNew.r0019.kimiBody",
      },
    ],
  },
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
  const [aCore, aPrerelease] = parseVersion(a);
  const [bCore, bPrerelease] = parseVersion(b);
  const len = Math.max(aCore.length, bCore.length);
  for (let i = 0; i < len; i++) {
    const d = (aCore[i] ?? 0) - (bCore[i] ?? 0);
    if (d !== 0) return d;
  }
  if (!aPrerelease && !bPrerelease) return 0;
  if (!aPrerelease) return 1;
  if (!bPrerelease) return -1;
  const prereleaseLength = Math.max(aPrerelease.length, bPrerelease.length);
  for (let i = 0; i < prereleaseLength; i++) {
    const left = aPrerelease[i];
    const right = bPrerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
    const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return left.localeCompare(right);
  }
  return 0;
}

function parseVersion(version: string): [number[], string[] | null] {
  const withoutBuild = version.split("+", 1)[0] ?? version;
  const separator = withoutBuild.indexOf("-");
  const core = separator >= 0 ? withoutBuild.slice(0, separator) : withoutBuild;
  const prerelease = separator >= 0 ? withoutBuild.slice(separator + 1) : "";
  return [
    core.split(".").map((segment) => Number.parseInt(segment, 10) || 0),
    prerelease ? prerelease.split(".") : null,
  ];
}

/** Newest entry that the running app version already includes (entry version
 *  <= current). Skips future entries sitting in the file before release. */
export function latestEntryFor(currentVersion: string): ChangelogEntry | null {
  for (const entry of CHANGELOG) {
    if (compareVersions(entry.version, currentVersion) <= 0) return entry;
  }
  return null;
}
