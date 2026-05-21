import { CMD, invoke } from "@/lib/ipc";
import type { SearchOptions, SearchResults } from "./search.types";

export const searchApi = {
  inProject(root: string, query: string, options?: SearchOptions): Promise<SearchResults> {
    return invoke<SearchResults>(CMD.searchInProject, {
      root,
      query,
      options: options ?? {
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        maxMatches: 500,
      },
    });
  },
};
