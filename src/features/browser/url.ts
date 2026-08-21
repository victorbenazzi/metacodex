/** Schemes the native webview will accept. Keep in sync with `is_allowed_url` in Rust. */
export function isAllowedBrowserUrl(url: string): boolean {
  if (url === "about:blank") return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.hostname === "mcx.invalid") return false;
    return true;
  } catch {
    return false;
  }
}

/** Turn an address-bar string into a navigable http(s) URL. */
export function normalizeBrowserUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s === "about:blank") return s;
  if (s.startsWith("about:")) return null;
  if (/^\d{2,5}$/.test(s)) return `http://localhost:${s}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    return isAllowedBrowserUrl(s) ? s : null;
  }
  if (
    s.startsWith("localhost") ||
    s.startsWith("127.0.0.1") ||
    s.startsWith("[::1]")
  ) {
    return `http://${s}`;
  }
  if (/^[\w.-]+:\d/.test(s)) return `http://${s}`;
  if (s.includes(" ") || !s.includes(".")) return null;
  return `https://${s}`;
}

export function isBlankBrowserUrl(url: string | null): boolean {
  return !url || url === "about:blank";
}
