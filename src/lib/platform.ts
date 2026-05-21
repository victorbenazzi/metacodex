/**
 * Platform detection — must work BEFORE Tauri APIs are reliably available,
 * so we infer from navigator.userAgent.
 *
 * For correctness-critical checks (e.g. shell selection), prefer the Rust side
 * via `os` plugin — never trust UA in security paths.
 */
export const isMac = /Mac/.test(navigator.userAgent || "");
export const isWindows = /Win/.test(navigator.userAgent || "");
export const isLinux = !isMac && !isWindows && /Linux/.test(navigator.userAgent || "");

export const modKey = isMac ? "Meta" : "Control";
export const modSymbol = isMac ? "⌘" : "Ctrl";
