/**
 * Shared helpers for the single-char git status codes the Rust side emits
 * (`src-tauri/src/git.rs::status_code`): M | A | ? | D | R | T | ! | C.
 *
 * Kept in one place so the file explorer badge, the Source Control panel, and
 * any future git surface stay visually and semantically in sync.
 */

export type GitStatusCode = "M" | "A" | "?" | "D" | "R" | "T" | "!" | "C";

/** i18n key for the human-readable meaning of a status code (see `git.status.*`). */
export function gitStatusLabelKey(code: string): string {
  switch (code) {
    case "M":
      return "git.status.modified";
    case "A":
      return "git.status.added";
    case "?":
      return "git.status.untracked";
    case "D":
      return "git.status.deleted";
    case "R":
      return "git.status.renamed";
    case "T":
      return "git.status.typechange";
    case "C":
      return "git.status.copied";
    case "!":
      return "git.status.conflicted";
    default:
      return "git.status.unknown";
  }
}

/** Tailwind text-color class for a status badge glyph. */
export function gitColorForBadge(status: string): string {
  if (status === "M" || status === "T") return "text-warn";
  if (status === "A") return "text-success";
  if (status === "?") return "text-success/70";
  if (status === "D") return "text-danger/85";
  if (status === "!") return "text-danger";
  return "text-muted";
}

/** Tailwind text-color class for a filename tinted by its status. */
export function gitColorForName(status?: string): string {
  if (!status) return "text-ink/85";
  if (status === "M" || status === "T") return "text-warn";
  if (status === "A") return "text-success";
  if (status === "?") return "text-success/85";
  if (status === "D") return "text-danger/85";
  if (status === "!") return "text-danger";
  return "text-ink/85";
}

/** Sort weight so the changed-files list groups conflicts/edits before adds. */
export function gitStatusRank(status: string): number {
  switch (status) {
    case "!":
      return 0;
    case "M":
    case "T":
      return 1;
    case "R":
      return 2;
    case "D":
      return 3;
    case "A":
      return 4;
    case "?":
      return 5;
    default:
      return 6;
  }
}
