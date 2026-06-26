export type TabKind = "editor" | "markdown" | "image" | "pdf" | "diff" | "terminal" | "cli";

export interface TabBase {
  id: string;
  kind: TabKind;
  /** Default title , basename for file tabs, label for process tabs. The
   *  displayed title is derived: `userTitle ?? agentTitle ?? title`. */
  title: string;
  projectId: string | null;
  dirty?: boolean;
  previewGrantId?: string;
  /** Last sanitized OSC 0/1/2 emitted by the running process (terminal/cli only).
   *  Cleared when the process exits. */
  agentTitle?: string;
  /** Manual rename via context menu / F2 / double-click (terminal/cli only).
   *  Always wins over `agentTitle` until cleared via "Reset title". */
  userTitle?: string;
}

export interface EditorTab extends TabBase {
  kind: "editor";
  path: string;
}
export interface MarkdownTab extends TabBase {
  kind: "markdown";
  path: string;
  mode: "preview" | "source";
}
export interface ImageTab extends TabBase {
  kind: "image";
  path: string;
}
export interface PdfTab extends TabBase {
  kind: "pdf";
  path: string;
}
export interface DiffTabT extends TabBase {
  kind: "diff";
  path: string;
  /** git status code (M | A | ? | D | R | T) , frames how the diff is shown. */
  status: string;
}
export interface TerminalTabT extends TabBase {
  kind: "terminal";
  cwd: string;
  /** Optional text written into the PTY after spawn (no trailing Enter) , used
   * to pre-fill install commands. The user reviews and submits manually. */
  prefillCommand?: string;
}
export interface CliTabT extends TabBase {
  kind: "cli";
  cwd: string;
  cliId: string;
  launchCommand: string;
}

export type Tab =
  | EditorTab
  | MarkdownTab
  | ImageTab
  | PdfTab
  | DiffTabT
  | TerminalTabT
  | CliTabT;

/** Resolve the displayed title with manual-rename > agent-rename > default
 *  precedence. Used everywhere except direct mutations of the underlying field. */
export function resolveTabTitle(tab: Tab): string {
  return tab.userTitle ?? tab.agentTitle ?? tab.title;
}

/** True for tabs whose title can be renamed (manually or by agent OSC). File
 *  tabs always show the basename , that's their identity. */
export function isRenamableTab(tab: Tab): boolean {
  return tab.kind === "terminal" || tab.kind === "cli";
}
