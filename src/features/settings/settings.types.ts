import { isLanguageId, type LanguageId } from "@/features/i18n/config";
import type { ThemeMode } from "@/features/theme/theme.store";
import { DEFAULT_LIGHT_THEME_ID, isThemeId } from "@/features/theme/themes";

export type TerminalCursorStyle = "bar" | "block" | "underline";

/**
 * The full set of user preferences persisted to `~/.metacodex/settings.json`.
 * `theme` and `language` mirror the existing theme/i18n stores (which still own
 * applying them); everything else is a tunable that maps to a hardcoded value
 * the app used to ship with — see `DEFAULT_SETTINGS`.
 */
export interface AppSettings {
  theme: ThemeMode;
  /** Active palette id (resolved against the theme registry). When absent the
   *  app derives a default from `theme` (light → solar-cream, dark → mono-slate). */
  themeId: string;
  language: LanguageId;
  editor: {
    fontSize: number;
    fontFamily: string;
    stickyScrollMaxHeaders: number;
  };
  terminal: {
    fontSize: number;
    fontFamily: string;
    scrollback: number;
    cursorStyle: TerminalCursorStyle;
  };
  performance: {
    workspaceSaveDebounceMs: number;
    searchDebounceMs: number;
  };
  /** Launcher visibility and other interface-level toggles. The new-tab menu
   *  reads these on every render — toggling immediately reflects in the UI. */
  interface: {
    /** Whether the "Autonomous Agents" sub-section starts expanded. Persists across sessions. */
    autonomousAgentsExpanded: boolean;
    /** Per-CLI visibility in the launcher menu. Missing keys default to true. */
    enabledAgents: Record<string, boolean>;
  };
}

/** Slices of `AppSettings` that are nested objects (patchable via `update`). */
export type SettingsSliceKey = "editor" | "terminal" | "performance" | "interface";

/** Default monospace stack for the terminal — verbatim from `useXterm.ts`. */
export const DEFAULT_TERMINAL_FONT_FAMILY =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono NFM", "SF Mono", ui-monospace, Menlo, monospace';

/**
 * Single source of truth for "what the app shipped with". Each value matches the
 * literal it replaces in its consumer (editorTheme.ts, useXterm.ts, AppShell.tsx,
 * SearchDialog.tsx, stickyScroll.ts).
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  themeId: DEFAULT_LIGHT_THEME_ID,
  language: "en",
  editor: {
    fontSize: 13,
    fontFamily: "var(--font-mono)",
    stickyScrollMaxHeaders: 5,
  },
  terminal: {
    fontSize: 13,
    fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    scrollback: 10_000,
    cursorStyle: "bar",
  },
  performance: {
    workspaceSaveDebounceMs: 350,
    searchDebounceMs: 150,
  },
  interface: {
    autonomousAgentsExpanded: true,
    enabledAgents: {},
  },
};

function clampNum(value: unknown, def: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return def;
  return Math.min(max, Math.max(min, value));
}

function str(value: unknown, def: string): string {
  return typeof value === "string" && value.length > 0 ? value : def;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], def: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : def;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Keep only `Record<string, boolean>` entries from a raw bag (hand-edited JSON
 *  may contain non-boolean values — silently drop those). */
function asBoolMap(value: unknown): Record<string, boolean> {
  const raw = asObject(value);
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

const THEME_VALUES: ThemeMode[] = ["system", "light", "dark"];
const CURSOR_VALUES: TerminalCursorStyle[] = ["bar", "block", "underline"];

/**
 * Coerce arbitrary (possibly hand-edited / partial) JSON into a fully-populated,
 * range-clamped `AppSettings`. Any missing or wrong-typed key falls back to its
 * default, so deleting a key — or the whole file — never crashes the app, and a
 * hand-typed `fontSize: 999999` can't wedge the UI.
 */
export function mergeSettings(raw: unknown): AppSettings {
  const r = asObject(raw);
  const editor = asObject(r.editor);
  const terminal = asObject(r.terminal);
  const perf = asObject(r.performance);
  const iface = asObject(r.interface);
  const D = DEFAULT_SETTINGS;
  return {
    theme: oneOf(r.theme, THEME_VALUES, D.theme),
    themeId: isThemeId(r.themeId) ? r.themeId : D.themeId,
    language: isLanguageId(r.language) ? r.language : D.language,
    editor: {
      fontSize: clampNum(editor.fontSize, D.editor.fontSize, 8, 32),
      fontFamily: str(editor.fontFamily, D.editor.fontFamily),
      stickyScrollMaxHeaders: Math.round(
        clampNum(editor.stickyScrollMaxHeaders, D.editor.stickyScrollMaxHeaders, 0, 20),
      ),
    },
    terminal: {
      fontSize: clampNum(terminal.fontSize, D.terminal.fontSize, 8, 32),
      fontFamily: str(terminal.fontFamily, D.terminal.fontFamily),
      scrollback: Math.round(clampNum(terminal.scrollback, D.terminal.scrollback, 0, 500_000)),
      cursorStyle: oneOf(terminal.cursorStyle, CURSOR_VALUES, D.terminal.cursorStyle),
    },
    performance: {
      workspaceSaveDebounceMs: Math.round(
        clampNum(perf.workspaceSaveDebounceMs, D.performance.workspaceSaveDebounceMs, 0, 5000),
      ),
      searchDebounceMs: Math.round(
        clampNum(perf.searchDebounceMs, D.performance.searchDebounceMs, 0, 5000),
      ),
    },
    interface: {
      autonomousAgentsExpanded:
        typeof iface.autonomousAgentsExpanded === "boolean"
          ? iface.autonomousAgentsExpanded
          : D.interface.autonomousAgentsExpanded,
      enabledAgents: asBoolMap(iface.enabledAgents),
    },
  };
}
