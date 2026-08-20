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
  kind:
    | { kind: "plain" }
    | {
        kind: "cli";
        executable: string;
        args: string[];
        environment: Record<string, string>;
      };
  label: string;
  cli_id?: string;
  /** App theme kind at spawn time. The backend exports it as COLORFGBG so
      background-detecting TUIs (Claude Code, vim, ...) pick the right theme.
      Injected centrally by `ptyApi.prepare`; callers never set it. */
  theme_kind?: "light" | "dark";
}

export type PtyBackendEvent =
  | { type: "data"; data_b64: string }
  | { type: "backpressure"; queue_depth: number; stalled_ms: number }
  | { type: "exit"; exit_code: number; reason: string };

export interface PtyBackendEventEnvelope {
  sessionId: string;
  seq: number;
  event: PtyBackendEvent;
}

export interface PtyPrepareResponse {
  sessionId: string;
}

export interface PtyAttachResponse {
  events: PtyBackendEventEnvelope[];
  lastSeq: number;
  state: "prepared" | "attached" | "starting" | "running" | "stopping" | "exited";
}

export type TerminalStartStep = "listeners" | "prepare" | "attach" | "child";
export type TerminalFailureStep = TerminalStartStep | "write" | "resize" | "kill";

export type TerminalRuntimeState =
  | { phase: "starting"; step: TerminalStartStep }
  | { phase: "running"; sessionId: string }
  | {
      phase: "failed";
      step: TerminalFailureStep;
      error: { code: string; message: string };
      retryable: boolean;
    }
  | { phase: "exited"; code: number; reason: string };
