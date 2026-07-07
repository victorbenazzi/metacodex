export type TerminalKind = "shell" | "cli";
export type TerminalStatus =
  | "starting"
  | "running"
  | "exited"
  | "error";

export interface TerminalSession {
  id: string;
  /** The tab hosting this session — used to reveal it (e.g. after sending text). */
  tabId?: string;
  projectId: string | null;
  cwd: string;
  kind: TerminalKind;
  cliToolId?: string;
  title: string;
  status: TerminalStatus;
  exitCode?: number;
  createdAt: string;
}

export interface PtySpawnSpec {
  project_id: string | null;
  cwd: string;
  rows: number;
  cols: number;
  kind: { kind: "plain" } | { kind: "cli"; command: string };
  label: string;
  cli_id?: string;
  /** App theme kind at spawn time. The backend exports it as COLORFGBG so
      background-detecting TUIs (Claude Code, vim, ...) pick the right theme.
      Injected centrally by `ptyApi.spawn`; callers never set it. */
  theme_kind?: "light" | "dark";
}
