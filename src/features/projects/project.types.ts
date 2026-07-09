export interface Project {
  id: string;
  name: string;
  path: string;
  origin: ProjectOrigin;
  color: string;
  /** Lucide icon name, e.g. "Folder", "Code", "BookOpen" */
  icon: string;
  createdAt: string;
  lastOpenedAt: string;
}

export type ProjectOrigin =
  | { kind: "local" }
  | { kind: "ssh"; accessId: string; remotePath: string };

export function isRemoteProject(project: Project | null | undefined): boolean {
  return project?.origin.kind === "ssh";
}

/**
 * What a project's origin supports. Every UI surface asks about the capability
 * it needs (`caps.search`, `caps.git`) instead of re-deriving "is this remote?"
 * on its own, so the rules live here. When an SSH capability lands (remote
 * search, remote git), flip its flag in `REMOTE_CAPABILITIES` and every gate
 * follows. The sidebar's SSH badge still asks `isRemoteProject` directly
 * because that is literally what it means.
 */
export interface ProjectCapabilities {
  /** Git status + gutter, the Source Control panel, and worktrees. */
  git: boolean;
  /** In-project content search (ripgrep) and the file palette. */
  search: boolean;
  /** Filesystem watcher and external-change reconcile. */
  watcher: boolean;
  /** Native "reveal in Finder / Explorer". */
  revealInFinder: boolean;
  /** Detecting whether a CLI is installed before launching it. */
  localCli: boolean;
}

const LOCAL_CAPABILITIES: ProjectCapabilities = {
  git: true,
  search: true,
  watcher: true,
  revealInFinder: true,
  localCli: true,
};

const REMOTE_CAPABILITIES: ProjectCapabilities = {
  git: false,
  search: false,
  watcher: false,
  revealInFinder: false,
  localCli: false,
};

export function projectCapabilities(
  project: Project | null | undefined,
): ProjectCapabilities {
  return isRemoteProject(project) ? REMOTE_CAPABILITIES : LOCAL_CAPABILITIES;
}

/**
 * Each accent ships a pair of hex variants tuned per theme:
 *   - `hex`  → canonical value (also the swatch the user picks); used on the
 *              warm-cream light canvas. Mid-saturated and mid-dark so the icon
 *              reads with weight against #f7f7f4.
 *   - `dark` → the same hue lifted toward white for the warm near-black canvas.
 *              Pre-baked instead of derived so dark tones stay vivid without
 *              looking washed out.
 *
 * The store persists only `hex`. `getPaletteEntry(hex)` does the lookup at
 * render time; legacy hex strings (from older palettes) get a programmatic
 * fallback in `tileIconColor`, so old projects never break.
 */
export interface PaletteEntry {
  hex: string;
  dark: string;
}

export const PROJECT_PALETTE: PaletteEntry[] = [
  { hex: "#8a7d63", dark: "#c0b294" }, // stone
  { hex: "#a85040", dark: "#d68a76" }, // terracotta
  { hex: "#b87420", dark: "#dfae70" }, // amber
  { hex: "#828c3f", dark: "#c1c885" }, // olive
  { hex: "#4a9070", dark: "#88c5a8" }, // sage
  { hex: "#2e7892", dark: "#7eb4c9" }, // ocean
  { hex: "#4658a8", dark: "#8e9dd9" }, // indigo
  { hex: "#7a52a8", dark: "#b194d9" }, // lavender
  { hex: "#a3548b", dark: "#d293ba" }, // mauve
  { hex: "#bb4565", dark: "#e889a1" }, // rose
  { hex: "#6a6e75", dark: "#a9abb0" }, // cool gray
  { hex: "#5d5c46", dark: "#a09e83" }, // deep olive
];

export function getPaletteEntry(hex: string): PaletteEntry | undefined {
  const normalized = hex.toLowerCase();
  return PROJECT_PALETTE.find((e) => e.hex.toLowerCase() === normalized);
}

/**
 * Curated Feather-style icons (sourced from lucide-react, which is the actively
 * maintained Feather fork). Kept to ~30 of the most useful project archetypes.
 * Names must match `lucide-react` exports — `getLucideIcon` looks them up by
 * key and falls back to `Folder` if missing.
 */
export const PROJECT_ICONS = [
  "Folder",
  "FolderGit2",
  "FolderOpen",
  "Code",
  "Code2",
  "Terminal",
  "Database",
  "Server",
  "Cloud",
  "Globe",
  "Cpu",
  "Layers",
  "Boxes",
  "Package",
  "BookOpen",
  "FileText",
  "Briefcase",
  "Sparkles",
  "Zap",
  "Star",
  "Heart",
  "Coffee",
  "Rocket",
  "Beaker",
  "Wrench",
  "Compass",
  "Image",
  "Music",
  "Video",
  "Smartphone",
  "Monitor",
  "Hash",
  "Activity",
  "Target",
  "PenTool",
] as const;
