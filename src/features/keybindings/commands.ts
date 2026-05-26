import type { CommandDef, CommandId } from "./types";

/**
 * The command registry. Declaration-only — it holds NO side effects. Each id
 * maps 1:1 to a dispatch target in `KeyboardShortcuts.tsx`, keeping the handler
 * implementations on `window.__metacodex` / the relevant stores (per CLAUDE.md).
 *
 * `mod` = Cmd on macOS, Ctrl elsewhere. Order in this array is the display order
 * in Settings and the deterministic tie-break order for conflicting bindings.
 */
export const COMMANDS: CommandDef[] = [
  {
    id: "terminal.new",
    defaultBinding: ["mod+t"],
    descriptionKey: "settings.shortcuts.cmd.terminalNew",
    category: "general",
  },
  {
    id: "folder.open",
    defaultBinding: ["mod+o"],
    descriptionKey: "settings.shortcuts.cmd.folderOpen",
    category: "general",
  },
  {
    id: "settings.open",
    defaultBinding: ["mod+,"],
    descriptionKey: "settings.shortcuts.cmd.settingsOpen",
    category: "general",
  },
  {
    id: "tab.close",
    defaultBinding: ["mod+w"],
    descriptionKey: "settings.shortcuts.cmd.tabClose",
    category: "view",
  },
  {
    id: "search.inProject",
    defaultBinding: ["mod+shift+f"],
    descriptionKey: "settings.shortcuts.cmd.searchInProject",
    category: "navigation",
  },
  {
    id: "palette.commands",
    defaultBinding: ["mod+shift+p"],
    descriptionKey: "settings.shortcuts.cmd.paletteCommands",
    category: "navigation",
  },
  {
    id: "palette.files",
    defaultBinding: ["mod+p"],
    descriptionKey: "settings.shortcuts.cmd.paletteFiles",
    category: "navigation",
  },
  {
    id: "project.switch",
    defaultBinding: [],
    descriptionKey: "settings.shortcuts.cmd.projectSwitch",
    category: "navigation",
    range: { from: 1, to: 9, bindingTemplate: "mod+{n}" },
  },
  {
    id: "file.save",
    defaultBinding: ["mod+s"],
    descriptionKey: "settings.shortcuts.cmd.fileSave",
    category: "editing",
    passive: true,
  },
  {
    id: "tab.jumpToNextAttention",
    defaultBinding: ["mod+shift+u"],
    descriptionKey: "settings.shortcuts.cmd.tabJumpToNextAttention",
    category: "navigation",
  },
  {
    id: "diagnostics.toggle",
    defaultBinding: ["mod+shift+d"],
    descriptionKey: "settings.shortcuts.cmd.diagnosticsToggle",
    category: "view",
  },
];

export const COMMANDS_BY_ID: Record<CommandId, CommandDef> = Object.fromEntries(
  COMMANDS.map((c) => [c.id, c]),
) as Record<CommandId, CommandDef>;

/** Commands resolved parametrically (via range), excluded from the static table. */
export const RANGE_COMMANDS: CommandDef[] = COMMANDS.filter((c) => c.range);
