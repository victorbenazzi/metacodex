/** Stable identifiers for every globally-bindable command. */
export type CommandId =
  | "terminal.new"
  | "folder.open"
  | "tab.close"
  | "project.switch"
  | "settings.open"
  | "search.inProject"
  | "palette.commands"
  | "palette.files"
  | "file.save";

export type CommandCategory = "general" | "navigation" | "view" | "editing";

/** A parsed key combination. `mod` is the platform primary (Cmd on macOS,
 *  Ctrl elsewhere); `ctrl` is literal Control even on macOS. */
export interface Binding {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Normalized key: single letters lowercased, named keys lowercased
   *  ("enter", "escape", "space"), punctuation verbatim (","). */
  key: string;
}

export interface CommandDef {
  id: CommandId;
  /** Default binding strings (canonical form, e.g. "mod+shift+f"). `[0]` is the
   *  canonical one shown in UI. Empty for purely-parametric commands. */
  defaultBinding: string[];
  /** i18n key for the human description shown in Settings. */
  descriptionKey: string;
  category: CommandCategory;
  /** Parametric binding (e.g. project switch: mod+1 .. mod+9). When present, this
   *  command is resolved via the range matcher, not the static binding table. */
  range?: { from: number; to: number; bindingTemplate: string };
  /** When true, the command resolves but the global dispatcher does NOT
   *  preventDefault — it's swallowed so another handler (e.g. CodeMirror's
   *  Mod-s) wins. */
  passive?: boolean;
}

/** A command resolved from a keyboard event, with the parametric arg if any. */
export interface ResolvedCommand {
  id: CommandId;
  arg?: number;
  passive?: boolean;
}
