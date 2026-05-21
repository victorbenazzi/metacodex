export interface Project {
  id: string;
  name: string;
  path: string;
  color: string;
  /** Lucide icon name, e.g. "Folder", "Code", "BookOpen" */
  icon: string;
  createdAt: string;
  lastOpenedAt: string;
}

export const PROJECT_PALETTE = [
  "#7c7666",
  "#8a6f4c",
  "#6f7a6a",
  "#7a6470",
  "#5f6e7a",
  "#806a5a",
  "#6a6b6f",
  "#73716a",
] as const;

/** Default lucide icon names users can pick for projects. */
export const PROJECT_ICONS = [
  "Folder",
  "Code",
  "Boxes",
  "BookOpen",
  "Hash",
  "Database",
  "Layers",
  "Terminal",
  "Cpu",
  "Sparkles",
  "Wrench",
  "Beaker",
] as const;
