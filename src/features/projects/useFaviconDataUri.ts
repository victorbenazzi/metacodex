import { useEffect, useState } from "react";

import { faviconApi } from "./favicon.service";

/**
 * Resolve a favicon path (absolute filesystem path) to a base64 data URI.
 * Returns `null` while loading or if the file can't be read (the caller is
 * expected to render a fallback icon in that case).
 */
export function useFaviconDataUri(absPath: string | null): string | null {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (!absPath) {
      setUri(null);
      return;
    }
    let cancelled = false;
    faviconApi
      .loadDataUri(absPath)
      .then((u) => {
        if (!cancelled) setUri(u);
      })
      .catch(() => {
        if (!cancelled) setUri(null);
      });
    return () => {
      cancelled = true;
    };
  }, [absPath]);
  return uri;
}
