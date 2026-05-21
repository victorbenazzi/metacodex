export interface GitInfo {
  branch: string | null;
  ahead: number;
  behind: number;
  /** Absolute file path → single-char status code: M | A | D | R | ? | C | T | ! */
  statuses: Record<string, string>;
}
