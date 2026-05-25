import type { Theme } from "./types";

/**
 * Write a Theme to the document by overriding the CSS custom properties that
 * components already read via `var(--*)`. The default values live in
 * `src/styles/tokens.css`; this function reassigns them at runtime.
 *
 * Conventions (mirrors the schema in types.ts):
 *   chrome.surfaceCard      → --surface-card
 *   syntax.controlKeyword   → --syntax-control-keyword
 *   terminal.brightBlue     → --term-bright-blue
 */
function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function setVars(prefix: string, dict: object) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(dict)) {
    if (typeof v !== "string") continue;
    root.style.setProperty(`${prefix}${camelToKebab(k)}`, v);
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme.kind);
  root.setAttribute("data-theme-id", theme.id);
  root.style.colorScheme = theme.kind;

  setVars("--", theme.chrome);
  setVars("--syntax-", theme.syntax);
  setVars("--term-", theme.terminal);
}
