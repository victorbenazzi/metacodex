import { isMac } from "@/lib/platform";

import { COMMANDS_BY_ID } from "./commands";
import type { Binding, CommandDef, CommandId, ResolvedCommand } from "./types";

const ALIASES: Record<string, string> = {
  cmd: "mod",
  meta: "mod",
  command: "mod",
  "⌘": "mod",
  control: "ctrl",
  option: "alt",
  opt: "alt",
  "⌥": "alt",
  "⇧": "shift",
  esc: "escape",
  return: "enter",
  "↵": "enter",
  // Arrow keys — `e.key` reports `ArrowLeft` (lowercased to `arrowleft`), but
  // user-facing bindings read more naturally as `left` / `right` / etc.
  left: "arrowleft",
  right: "arrowright",
  up: "arrowup",
  down: "arrowdown",
  "←": "arrowleft",
  "→": "arrowright",
  "↑": "arrowup",
  "↓": "arrowdown",
};

/** Parse a canonical-ish binding string ("mod+shift+f") into a `Binding`. */
export function parseBinding(s: string): Binding {
  const b: Binding = { mod: false, ctrl: false, alt: false, shift: false, key: "" };
  for (const raw of s.toLowerCase().split("+")) {
    const token = (ALIASES[raw] ?? raw).trim();
    if (!token) continue;
    if (token === "mod") b.mod = true;
    else if (token === "ctrl") b.ctrl = true;
    else if (token === "alt") b.alt = true;
    else if (token === "shift") b.shift = true;
    else b.key = token;
  }
  return b;
}

/** Canonical string form — modifiers in a fixed order so equivalent bindings
 *  compare equal (used as the conflict/dedupe key). */
export function formatBinding(b: Binding): string {
  const parts: string[] = [];
  if (b.mod) parts.push("mod");
  if (b.ctrl) parts.push("ctrl");
  if (b.alt) parts.push("alt");
  if (b.shift) parts.push("shift");
  if (b.key) parts.push(b.key);
  return parts.join("+");
}

export function bindingKey(b: Binding): string {
  return formatBinding(b);
}

function normalizeKey(key: string): string {
  if (key === " " || key === "Spacebar") return "space";
  return key.toLowerCase();
}

/** A keyboard event as a normalized `Binding` (same shape `parseBinding` yields). */
export function eventToBinding(e: KeyboardEvent): Binding {
  return {
    mod: isMac ? e.metaKey : e.ctrlKey,
    // On non-mac, Ctrl IS the primary modifier — don't also count it as `ctrl`.
    ctrl: isMac ? e.ctrlKey : false,
    alt: e.altKey,
    shift: e.shiftKey,
    key: normalizeKey(e.key),
  };
}

/** True when the event carries no real key yet (a lone modifier press). */
export function isModifierOnly(e: KeyboardEvent): boolean {
  return ["Control", "Shift", "Alt", "Meta", "OS", "AltGraph", "CapsLock"].includes(e.key);
}

const NAMED_DISPLAY: Record<string, string> = {
  enter: "Enter",
  escape: "Esc",
  tab: "Tab",
  backspace: "Backspace",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
};

/** Tokens for `<Kbd keys={…}>` from a binding string, e.g.
 *  "mod+shift+f" → ["Mod","Shift","F"]. */
export function bindingToKbdTokens(s: string): string[] {
  const b = parseBinding(s);
  const tokens: string[] = [];
  if (b.mod) tokens.push("Mod");
  if (b.ctrl) tokens.push("Ctrl");
  if (b.alt) tokens.push("Alt");
  if (b.shift) tokens.push("Shift");
  if (b.key) {
    tokens.push(NAMED_DISPLAY[b.key] ?? (b.key.length === 1 ? b.key.toUpperCase() : b.key));
  }
  return tokens;
}

function tryMatchRange(ev: Binding, c: CommandDef): number | null {
  if (!c.range) return null;
  const tmpl = parseBinding(c.range.bindingTemplate.replace("{n}", "0"));
  if (
    ev.mod !== tmpl.mod ||
    ev.ctrl !== tmpl.ctrl ||
    ev.alt !== tmpl.alt ||
    ev.shift !== tmpl.shift
  ) {
    return null;
  }
  const n = Number(ev.key);
  if (!Number.isInteger(n) || n < c.range.from || n > c.range.to) return null;
  return n;
}

/**
 * Resolve a keyboard event to a command. Exact bindings win; otherwise the
 * parametric range commands (e.g. mod+1..9) are tried. Returns null when nothing
 * matches (so plain typing falls through untouched).
 */
export function matchBinding(
  ev: Binding,
  table: Map<string, CommandId>,
  rangeCommands: CommandDef[],
): ResolvedCommand | null {
  const exact = table.get(bindingKey(ev));
  if (exact) return { id: exact, passive: COMMANDS_BY_ID[exact].passive };
  for (const c of rangeCommands) {
    const arg = tryMatchRange(ev, c);
    if (arg != null) return { id: c.id, arg, passive: c.passive };
  }
  return null;
}
