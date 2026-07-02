import { listen, type UnlistenFn, type EventCallback } from "@tauri-apps/api/event";

export const EV = {
  ptyData: "pty://data",
  ptyExit: "pty://exit",
  ptyBackpressure: "pty://backpressure",
  fsChanged: "fs://changed",
  fsRenamed: "fs://renamed",
  beforeQuit: "app://before-quit",
  gitCloneProgress: "git://clone-progress",
  openFile: "app://open-file",
} as const;

export type EventName = (typeof EV)[keyof typeof EV];

// Mirrors the reasons Rust actually emits (see events.rs::PtyExitPayload).
export type PtyExitReason = "normal" | "reader_error" | "killed" | "drainer_stalled";

export interface PtyDataPayload {
  session_id: string;
  data_b64: string;
}
export interface PtyExitPayload {
  session_id: string;
  exit_code: number;
  // Optional for backwards compatibility , older Rust builds emit without it.
  reason?: PtyExitReason;
}

export interface PtyBackpressurePayload {
  sessionId: string;
  queueDepth: number;
  stalledMs: number;
}

export interface FsChangedPayload {
  projectId: string;
  paths: string[];
}

export interface FsRenamedPayload {
  projectId: string;
  oldPath: string;
  newPath: string;
}

export interface GitCloneProgressPayload {
  opId: string;
  phase: string;
  percent: number;
}

export interface PreviewGrant {
  path: string;
  grantId: string;
}

export interface OpenFilePayload {
  files: PreviewGrant[];
}

// Rust backpressure payload uses serde camelCase , matches the field names above
// for PtyBackpressurePayload but kept explicit here for clarity at IPC boundary.

export function listenTo<T>(event: EventName, handler: EventCallback<T>): Promise<UnlistenFn> {
  return listen<T>(event, handler);
}
