import { listen, type UnlistenFn, type EventCallback } from "@tauri-apps/api/event";

export const EV = {
  ptyData: "pty://data",
  ptyExit: "pty://exit",
  projectChanged: "project://changed",
  fsError: "fs://error",
  fsChanged: "fs://changed",
} as const;

export type EventName = (typeof EV)[keyof typeof EV];

export interface PtyDataPayload {
  session_id: string;
  data_b64: string;
}
export interface PtyExitPayload {
  session_id: string;
  exit_code: number;
}

export interface FsChangedPayload {
  projectId: string;
  paths: string[];
}

export function listenTo<T>(event: EventName, handler: EventCallback<T>): Promise<UnlistenFn> {
  return listen<T>(event, handler);
}
