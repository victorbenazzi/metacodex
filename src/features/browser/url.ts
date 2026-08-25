const LOCAL_BROWSER_SCHEME = "metacodex-file:";
const BROWSER_PREVIEW_EXTENSIONS = new Set([
  "html",
  "htm",
  "js",
  "mjs",
  "cjs",
  "css",
  "pdf",
]);

function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith("/") || /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\");
}

export type BrowserExternalTarget =
  | { command: "openExternalUrl"; value: string }
  | { command: "openExternalPath"; value: string };

function fileUrlPath(parsed: URL): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (parsed.hostname) {
    return `\\\\${parsed.hostname}${pathname.replaceAll("/", "\\")}`;
  }
  if (/^\/[a-z]:\//i.test(pathname)) {
    return pathname.slice(1).replaceAll("/", "\\");
  }
  return pathname.startsWith("/") ? pathname : null;
}

function isLocalBrowserUrl(parsed: URL): boolean {
  return (
    parsed.protocol === LOCAL_BROWSER_SCHEME ||
    (parsed.hostname.startsWith("metacodex-file.") && parsed.hostname.endsWith(".localhost"))
  );
}

/** Schemes the native webview will accept. Keep in sync with `is_allowed_url` in Rust. */
export function isAllowedBrowserUrl(url: string): boolean {
  if (url === "about:blank") return true;
  try {
    const parsed = new URL(url);
    if (isLocalBrowserUrl(parsed)) return true;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.hostname === "mcx.invalid") return false;
    return true;
  } catch {
    return false;
  }
}

/** Turn an address-bar string into a URL or an absolute local path for native authorization. */
export function normalizeBrowserUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s === "about:blank") return s;
  if (s.startsWith("about:")) return null;
  if (isAbsoluteLocalPath(s)) return s;
  if (s.startsWith("file://")) {
    try {
      return new URL(s).protocol === "file:" ? s : null;
    } catch {
      return null;
    }
  }
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

/** Resolve an address-bar value to the narrow native opener it is allowed to use. */
export function browserExternalTarget(raw: string): BrowserExternalTarget | null {
  const value = raw.trim();
  if (isAbsoluteLocalPath(value)) {
    return { command: "openExternalPath", value };
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "file:") {
      const path = fileUrlPath(parsed);
      return path ? { command: "openExternalPath", value: path } : null;
    }
    if (isLocalBrowserUrl(parsed)) return null;
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { command: "openExternalUrl", value };
    }
  } catch {
    return null;
  }
  return null;
}

export function isBrowserPreviewFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot === path.length - 1) return false;
  return BROWSER_PREVIEW_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

export function isBlankBrowserUrl(url: string | null): boolean {
  return !url || url === "about:blank";
}
