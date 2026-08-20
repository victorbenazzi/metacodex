import { listen, type UnlistenFn, type EventCallback } from "@tauri-apps/api/event";

export const EV = {
  ptyData: "pty://data",
  ptyExit: "pty://exit",
  ptyBackpressure: "pty://backpressure",
  fsChanged: "fs://changed",
  fsRenamed: "fs://renamed",
  prepareQuit: "app://prepare-quit",
  quitBlocked: "app://quit-blocked",
  gitCloneProgress: "git://clone-progress",
  openFile: "app://open-file",
  browserNavigated: "browser://navigated",
  browserPicked: "browser://picked",
  browserEscape: "browser://escape",
} as const;

export type EventName = (typeof EV)[keyof typeof EV];

// Mirrors the reasons Rust actually emits (see events.rs::PtyExitPayload).
export type PtyExitReason =
  | "normal"
  | "reader_error"
  | "killed"
  | "drainer_stalled"
  | "spawn_failed";

export interface PtyDataPayload {
  session_id: string;
  seq: number;
  data_b64: string;
}
export interface PtyExitPayload {
  session_id: string;
  seq: number;
  exit_code: number;
  reason: PtyExitReason;
}

export interface PtyBackpressurePayload {
  sessionId: string;
  seq: number;
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

export interface BrowserNavigatedPayload {
  url: string;
  title: string;
  loading: boolean;
}

export interface QuitFailure {
  area: string;
  code: string;
  message: string;
}

export interface PrepareQuitPayload {
  token: string;
  deadlineMs: number;
}

export interface QuitBlockedPayload {
  token: string;
  failures: QuitFailure[];
}

// Rust backpressure payload uses serde camelCase , matches the field names above
// for PtyBackpressurePayload but kept explicit here for clarity at IPC boundary.

export function listenTo<T>(event: EventName, handler: EventCallback<T>): Promise<UnlistenFn> {
  return listen<T>(event, handler);
}

/** Subscribe that cannot leak if the component unmounts before `listen()` resolves. */
export function listenWhileMounted<T>(event: EventName, handler: EventCallback<T>): () => void {
  let cancelled = false;
  let unlisten: UnlistenFn | undefined;
  void listenTo<T>(event, handler).then((off) => {
    if (cancelled) off();
    else unlisten = off;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
