export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  maxMatches?: number;
}

export interface SearchMatch {
  line: number;
  start: number;
  end: number;
  lineText: string;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResults {
  files: SearchFileResult[];
  totalMatches: number;
  truncated: boolean;
  elapsedMs: number;
}
