import {
  Activity,
  AiBrain,
  AiChip,
  AiGenerative,
  AiMagic,
  AiNetwork,
  AiProgramming,
  Beaker,
  BookOpen,
  Bot,
  Boxes,
  Briefcase,
  Cloud,
  Code,
  Code2,
  Coffee,
  Compass,
  Cpu,
  Database,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  Globe,
  Hash,
  Heart,
  Image,
  Layers,
  Monitor,
  Music,
  Package,
  PenTool,
  Robot,
  Rocket,
  Server,
  Smartphone,
  Sparkles,
  Star,
  Target,
  Terminal,
  Video,
  Wrench,
  Zap,
  type IconComponent,
} from "@/components/ui/icons";
import { PROJECT_ICONS } from "@/features/projects/project.types";

/**
 * Shared project-identity helpers used wherever a project renders its mark:
 * the rail tile (`ProjectTile`), the sidebar-row glyph (`ProjectGlyph`), the
 * empty-state hero and the send-to-project chips. Kept here so the
 * monogram/icon rules have one home and can't drift between render sites.
 */

/** Static glyph per picker name. Typed against PROJECT_ICONS so adding a name
 *  to the picker without a glyph here is a compile error (and vice versa the
 *  map can't silently carry dead entries). Static imports keep the icon set
 *  tree-shakeable, unlike the old wildcard lookup into the whole library. */
const PROJECT_GLYPHS: Record<(typeof PROJECT_ICONS)[number], IconComponent> = {
  Folder,
  FolderGit2,
  FolderOpen,
  Code,
  Code2,
  Terminal,
  Database,
  Server,
  Cloud,
  Globe,
  Cpu,
  Layers,
  Boxes,
  Package,
  BookOpen,
  FileText,
  Briefcase,
  Sparkles,
  Zap,
  Star,
  Heart,
  Coffee,
  Rocket,
  Beaker,
  Wrench,
  Compass,
  Image,
  Music,
  Video,
  Smartphone,
  Monitor,
  Hash,
  Activity,
  Target,
  PenTool,
  Bot,
  Robot,
  AiBrain,
  AiChip,
  AiMagic,
  AiNetwork,
  AiProgramming,
  AiGenerative,
};

/** Resolve a persisted project-icon name to its component. Returns null when
 *  the name doesn't match, so the caller falls through to the typographic
 *  monogram. Old lucide-era names persisted in projects.json keep resolving:
 *  the map keys ARE those names. */
export function lookupProjectGlyph(name: string): IconComponent | null {
  return (PROJECT_GLYPHS as Record<string, IconComponent>)[name] ?? null;
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
