export type TabKind = "editor" | "markdown" | "image" | "pdf" | "diff" | "terminal" | "cli";

export interface TabBase {
  id: string;
  kind: TabKind;
  title: string;
  projectId: string | null;
  dirty?: boolean;
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
  /** git status code (M | A | ? | D | R | T) — frames how the diff is shown. */
  status: string;
}
export interface TerminalTabT extends TabBase {
  kind: "terminal";
  cwd: string;
  /** Optional text written into the PTY after spawn (no trailing Enter) — used
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
