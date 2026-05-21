export type TerminalKind = "shell" | "cli";
export type TerminalStatus =
  | "starting"
  | "running"
  | "exited"
  | "error";

export interface TerminalSession {
  id: string;
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
}
