import { EV, listenTo, type PtyDataPayload, type PtyExitPayload } from "@/lib/events";

type Handler<T> = (payload: T) => void;

const dataHandlers = new Map<string, Set<Handler<PtyDataPayload>>>();
const exitHandlers = new Map<string, Set<Handler<PtyExitPayload>>>();

let dataOff: (() => void) | null = null;
let exitOff: (() => void) | null = null;
let dataStarting = false;
let exitStarting = false;

function maybeStop() {
  if (dataHandlers.size === 0 && dataOff) {
    dataOff();
    dataOff = null;
  }
  if (exitHandlers.size === 0 && exitOff) {
    exitOff();
    exitOff = null;
  }
}

function ensureDataListener() {
  if (dataOff || dataStarting) return;
  dataStarting = true;
  void listenTo<PtyDataPayload>(EV.ptyData, (event) => {
    const handlers = dataHandlers.get(event.payload.session_id);
    if (!handlers) return;
    for (const handler of handlers) handler(event.payload);
  })
    .then((off) => {
      dataStarting = false;
      if (dataHandlers.size === 0) {
        off();
      } else {
        dataOff = off;
      }
    })
    .catch((err) => {
      dataStarting = false;
      console.warn("[pty] data listener failed", err);
    });
}

function ensureExitListener() {
  if (exitOff || exitStarting) return;
  exitStarting = true;
  void listenTo<PtyExitPayload>(EV.ptyExit, (event) => {
    const handlers = exitHandlers.get(event.payload.session_id);
    if (!handlers) return;
    for (const handler of handlers) handler(event.payload);
  })
    .then((off) => {
      exitStarting = false;
      if (exitHandlers.size === 0) {
        off();
      } else {
        exitOff = off;
      }
    })
    .catch((err) => {
      exitStarting = false;
      console.warn("[pty] exit listener failed", err);
    });
}

export function subscribePtyData(sessionId: string, handler: Handler<PtyDataPayload>) {
  const set = dataHandlers.get(sessionId) ?? new Set<Handler<PtyDataPayload>>();
  set.add(handler);
  dataHandlers.set(sessionId, set);
  ensureDataListener();
  return () => {
    const current = dataHandlers.get(sessionId);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) dataHandlers.delete(sessionId);
    maybeStop();
  };
}

export function subscribePtyExit(sessionId: string, handler: Handler<PtyExitPayload>) {
  const set = exitHandlers.get(sessionId) ?? new Set<Handler<PtyExitPayload>>();
  set.add(handler);
  exitHandlers.set(sessionId, set);
  ensureExitListener();
  return () => {
    const current = exitHandlers.get(sessionId);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) exitHandlers.delete(sessionId);
    maybeStop();
  };
}
