import { isLanguageId, type LanguageId } from "@/features/i18n/config";
import type { ThemeMode } from "@/features/theme/theme.store";
import { DEFAULT_LIGHT_THEME_ID, isThemeId } from "@/features/theme/themes";
import {
  AGENT_MODES,
  PERMISSION_PRESETS,
  type AgentMode,
  type PermissionPreset,
} from "@/features/agent/opencode";

export type TerminalCursorStyle = "bar" | "block" | "underline";

/** Visual style for file/folder icons in the explorer. `mono` follows the
 *  current text color (token-driven, premium minimalist look); `color` paints
 *  brand-known files with their canonical brand hex while folders + generic
 *  files stay monochrome — a focused color pop, not a rainbow. */
export type ExplorerIconStyle = "mono" | "color";

/** Global density tier. Multiplies the `--space-*` token scale by 0.85 / 1 /
 *  1.15 — touches every spacing-based surface uniformly without touching
 *  per-component values. */
export type UiDensity = "compact" | "comfortable" | "spacious";

/** Numeric multiplier each density tier maps to. Kept here next to the type
 *  so the AppShell consumer and SettingsDialog UI agree on the same scale. */
export const UI_DENSITY_MULTIPLIER: Record<UiDensity, number> = {
  compact: 0.85,
  comfortable: 1,
  spacious: 1.15,
};

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
    /** File/folder icon style in the explorer tree. */
    explorerIconStyle: ExplorerIconStyle;
    /** Global spacing density (compact / comfortable / spacious). */
    uiDensity: UiDensity;
  };
  /** Persisted horizontal dimensions of the resizable shell panels. Survives
   *  project switches and app restarts. Widths are integers in px; the diff
   *  split is the fraction of the diff viewport occupied by the HEAD side. */
  panels: {
    explorerWidth: number;
    sourceControlWidth: number;
    diffSplitRatio: number;
  };
  /** Surfaces around agent activity in terminal tabs. When an agent finishes
   *  or asks for input we update the tab badge unconditionally; OS banners and
   *  sound are user-controlled here. */
  notifications: {
    /** Show a macOS notification banner when an agent emits OSC 9/99/777 or
     *  the heuristic flags `needs-attention`. Default: on (opt-out). */
    osNotificationsEnabled: boolean;
    /** Play a short chime alongside the banner. Default: on. */
    soundEnabled: boolean;
    /** Fire the OS banner even when the metacodex window is focused AND the
     *  affected tab is the active one. Default: off (the badge is enough). */
    notifyWhenFocused: boolean;
  };
  /** Agent View runtime defaults. The opencode GO key itself is held by the
   *  runtime (opencode's own auth store), never persisted here — this only
   *  remembers the provider + default model the user picked. */
  agent: {
    providerId: string;
    modelId: string;
    /** Permission posture applied to new agent sessions. */
    permissionPreset: PermissionPreset;
    /** Single primary agent vs an orchestrator that delegates to subagents. */
    mode: AgentMode;
    /** Vision relay: model that describes images for non-vision chat models.
     *  Empty = auto (first attachment-capable model in the catalog). */
    visionProviderId: string;
    visionModelId: string;
    /** Which catalog models show in the composer's model picker, keyed
     *  `providerId/modelId`. ABSENT key = the default rule (enabled only for
     *  the opencode-go provider), so new GO models appear without migration
     *  and everything else stays opt-in. See `isModelEnabled`. */
    enabledModels: Record<string, boolean>;
    /** Chosen reasoning variant per model (`providerId/modelId` → variant
     *  name, e.g. "high"). Absent/"" = the model's default effort. */
    variantByModel: Record<string, string>;
  };
}

/** Catalog key for the per-model settings records. */
export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

/** Composer visibility rule: explicit user choice wins; otherwise only the
 *  opencode-go provider's models are shown by default. */
export function isModelEnabled(
  enabledModels: Record<string, boolean>,
  providerId: string,
  modelId: string,
): boolean {
  return enabledModels[modelKey(providerId, modelId)] ?? providerId === "opencode-go";
}

/** Slices of `AppSettings` that are nested objects (patchable via `update`). */
export type SettingsSliceKey =
  | "editor"
  | "terminal"
  | "performance"
  | "interface"
  | "panels"
  | "notifications"
  | "agent";

/** Resize bounds for the shell panels. Conventions:
 *  - Explorer: VS Code uses ~170px floor; we sit slightly above so the path
 *    column stays legible. The ceiling keeps the editor area dominant.
 *  - Source Control: similar reasoning but wider floor since the file list
 *    needs room for badges + relative path.
 *  - Diff split: 0.2 / 0.8 mirrors common merge-tool limits so one side never
 *    collapses to unusable. */
export const PANEL_LIMITS = {
  explorer: { min: 180, max: 480, default: 248 },
  sourceControl: { min: 240, max: 560, default: 340 },
  diff: { min: 0.2, max: 0.8, default: 0.5 },
} as const;

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
    explorerIconStyle: "mono",
    uiDensity: "comfortable",
  },
  panels: {
    explorerWidth: PANEL_LIMITS.explorer.default,
    sourceControlWidth: PANEL_LIMITS.sourceControl.default,
    diffSplitRatio: PANEL_LIMITS.diff.default,
  },
  notifications: {
    osNotificationsEnabled: true,
    soundEnabled: true,
    notifyWhenFocused: false,
  },
  agent: {
    providerId: "opencode-go",
    modelId: "",
    permissionPreset: "ask",
    mode: "agent",
    // Vision relay default: Kimi K2.5 on the GO provider (cheap, sees images).
    // The relay falls back to auto-pick if this id ever leaves the catalog.
    visionProviderId: "opencode-go",
    visionModelId: "kimi-k2.5",
    enabledModels: {},
    variantByModel: {},
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

/** Same contract as [`asBoolMap`] for `Record<string, string>` bags. */
function asStringMap(value: unknown): Record<string, string> {
  const raw = asObject(value);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

const THEME_VALUES: ThemeMode[] = ["system", "light", "dark"];
const CURSOR_VALUES: TerminalCursorStyle[] = ["bar", "block", "underline"];
const ICON_STYLE_VALUES: ExplorerIconStyle[] = ["mono", "color"];
const DENSITY_VALUES: UiDensity[] = ["compact", "comfortable", "spacious"];

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
  const panels = asObject(r.panels);
  const notif = asObject(r.notifications);
  const ag = asObject(r.agent);
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
      explorerIconStyle: oneOf(
        iface.explorerIconStyle,
        ICON_STYLE_VALUES,
        D.interface.explorerIconStyle,
      ),
      uiDensity: oneOf(iface.uiDensity, DENSITY_VALUES, D.interface.uiDensity),
    },
    panels: {
      explorerWidth: Math.round(
        clampNum(
          panels.explorerWidth,
          D.panels.explorerWidth,
          PANEL_LIMITS.explorer.min,
          PANEL_LIMITS.explorer.max,
        ),
      ),
      sourceControlWidth: Math.round(
        clampNum(
          panels.sourceControlWidth,
          D.panels.sourceControlWidth,
          PANEL_LIMITS.sourceControl.min,
          PANEL_LIMITS.sourceControl.max,
        ),
      ),
      diffSplitRatio: clampNum(
        panels.diffSplitRatio,
        D.panels.diffSplitRatio,
        PANEL_LIMITS.diff.min,
        PANEL_LIMITS.diff.max,
      ),
    },
    notifications: {
      osNotificationsEnabled:
        typeof notif.osNotificationsEnabled === "boolean"
          ? notif.osNotificationsEnabled
          : D.notifications.osNotificationsEnabled,
      soundEnabled:
        typeof notif.soundEnabled === "boolean"
          ? notif.soundEnabled
          : D.notifications.soundEnabled,
      notifyWhenFocused:
        typeof notif.notifyWhenFocused === "boolean"
          ? notif.notifyWhenFocused
          : D.notifications.notifyWhenFocused,
    },
    agent: {
      providerId: str(ag.providerId, D.agent.providerId),
      modelId: str(ag.modelId, D.agent.modelId),
      permissionPreset: oneOf(ag.permissionPreset, PERMISSION_PRESETS, D.agent.permissionPreset),
      mode: oneOf(ag.mode, AGENT_MODES, D.agent.mode),
      visionProviderId: str(ag.visionProviderId, D.agent.visionProviderId),
      visionModelId: str(ag.visionModelId, D.agent.visionModelId),
      enabledModels: asBoolMap(ag.enabledModels),
      variantByModel: asStringMap(ag.variantByModel),
    },
  };
}
