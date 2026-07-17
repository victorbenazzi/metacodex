export interface Project {
  id: string;
  name: string;
  path: string;
  /** Hex assigned by the Rust registry at creation. Persisted for backwards
   *  compatibility; the UI no longer tints anything with it. */
  color: string;
  /** Project glyph name from PROJECT_ICONS, e.g. "Folder", "Code", "AiBrain",
   *  or a custom image URI. */
  icon: string;
  createdAt: string;
  lastOpenedAt: string;
}

/**
 * Curated project glyphs shown in the icon picker. Each name resolves through
 * `projectIdentity.ts::lookupProjectGlyph` (Hugeicons stroke-rounded via the
 * central `components/ui/icons` registry). Names are persisted in
 * projects.json, so entries can be added but never renamed or removed without
 * a migration; unknown names fall back to the typographic monogram.
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
  // AI archetypes (agent-first projects)
  "Bot",
  "Robot",
  "AiBrain",
  "AiChip",
  "AiMagic",
  "AiNetwork",
  "AiProgramming",
  "AiGenerative",
] as const;
