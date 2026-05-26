import {
  Folder,
  FolderArchive,
  FolderClosed,
  FolderCog,
  FolderGit2,
  FolderLock,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

/**
 * Smart folder icons — pure Lucide so the visual weight matches generic folders.
 * Lookups are case-insensitive against the folder basename. Anything not in the
 * map falls back to the default `Folder` / `FolderOpen` pair.
 */
interface FolderIconPair {
  closed: LucideIcon;
  open: LucideIcon;
}

const DEFAULT_PAIR: FolderIconPair = { closed: Folder, open: FolderOpen };

const GIT_PAIR: FolderIconPair = { closed: FolderGit2, open: FolderGit2 };
const COG_PAIR: FolderIconPair = { closed: FolderCog, open: FolderCog };
const ARCHIVE_PAIR: FolderIconPair = { closed: FolderArchive, open: FolderArchive };
const SEALED_PAIR: FolderIconPair = { closed: FolderClosed, open: FolderClosed };
const LOCK_PAIR: FolderIconPair = { closed: FolderLock, open: FolderLock };

const BY_NAME: Record<string, FolderIconPair> = {
  // Git / VCS
  ".git": GIT_PAIR,
  ".github": GIT_PAIR,
  ".gitlab": GIT_PAIR,
  ".husky": GIT_PAIR,

  // Editor / tooling config dirs
  ".vscode": COG_PAIR,
  ".idea": COG_PAIR,
  ".devcontainer": COG_PAIR,
  ".config": COG_PAIR,
  ".changeset": COG_PAIR,

  // Build / derived output (sealed look — read-only by convention)
  dist: ARCHIVE_PAIR,
  build: ARCHIVE_PAIR,
  out: ARCHIVE_PAIR,
  target: ARCHIVE_PAIR,
  ".next": ARCHIVE_PAIR,
  ".nuxt": ARCHIVE_PAIR,
  ".svelte-kit": ARCHIVE_PAIR,
  ".astro": ARCHIVE_PAIR,
  ".vercel": ARCHIVE_PAIR,
  ".netlify": ARCHIVE_PAIR,
  ".turbo": ARCHIVE_PAIR,
  ".parcel-cache": ARCHIVE_PAIR,
  ".cache": ARCHIVE_PAIR,
  coverage: ARCHIVE_PAIR,

  // External deps (visually heavy: closed-folder look)
  node_modules: SEALED_PAIR,
  vendor: SEALED_PAIR,
  bower_components: SEALED_PAIR,

  // Secrets / locks
  ".ssh": LOCK_PAIR,
  ".aws": LOCK_PAIR,
};

export function resolveFolderIcon(name: string, isOpen: boolean): LucideIcon {
  const pair = BY_NAME[name.toLowerCase()] ?? DEFAULT_PAIR;
  return isOpen ? pair.open : pair.closed;
}
