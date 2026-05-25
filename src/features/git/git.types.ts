export interface GitInfo {
  branch: string | null;
  ahead: number;
  behind: number;
  /** Absolute file path → single-char status code: M | A | D | R | ? | C | T | ! */
  statuses: Record<string, string>;
  stats?: GitStats;
}

export interface GitStats {
  additions: number;
  deletions: number;
  /** Absolute file path → diff line counts against HEAD. */
  files: Record<string, GitFileStats>;
}

export interface GitFileStats {
  additions: number;
  deletions: number;
}
