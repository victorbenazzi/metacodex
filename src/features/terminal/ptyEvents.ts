import {
  EV,
  type EventName,
  type PtyDataPayload,
  type PtyExitPayload,
} from "@/lib/events";
import { ptyEventMultiplexer } from "./ptyEventMultiplexer";

type Handler<T> = (payload: T) => void;
type EventEnvelope<T> = { payload: T };
type Listener = <T>(
  event: EventName,
  handler: (event: EventEnvelope<T>) => void,
) => Promise<() => void>;

export type PtyEventSubscriptions = {
  subscribeData: (sessionId: string, handler: Handler<PtyDataPayload>) => () => void;
  subscribeExit: (sessionId: string, handler: Handler<PtyExitPayload>) => () => void;
};

export function createPtyEventSubscriptions(
  listen: Listener,
  onError: (kind: "data" | "exit", error: unknown) => void = (kind, error) => {
    console.warn(`[pty] ${kind} listener failed`, error);
  },
): PtyEventSubscriptions {
  const dataHandlers = new Map<string, Set<Handler<PtyDataPayload>>>();
  const exitHandlers = new Map<string, Set<Handler<PtyExitPayload>>>();
  let dataOff: (() => void) | null = null;
  let exitOff: (() => void) | null = null;
  let dataStarting = false;
  let exitStarting = false;

  const maybeStop = () => {
    if (dataHandlers.size === 0 && dataOff) {
      dataOff();
      dataOff = null;
    }
    if (exitHandlers.size === 0 && exitOff) {
      exitOff();
      exitOff = null;
    }
  };

  const ensureDataListener = () => {
    if (dataOff || dataStarting) return;
    dataStarting = true;
    void listen<PtyDataPayload>(EV.ptyData, (event) => {
      const handlers = dataHandlers.get(event.payload.session_id);
      if (!handlers) return;
      for (const handler of handlers) handler(event.payload);
    })
      .then((off) => {
        dataStarting = false;
        if (dataHandlers.size === 0) off();
        else dataOff = off;
      })
      .catch((error) => {
        dataStarting = false;
        onError("data", error);
      });
  };

  const ensureExitListener = () => {
    if (exitOff || exitStarting) return;
    exitStarting = true;
    void listen<PtyExitPayload>(EV.ptyExit, (event) => {
      const handlers = exitHandlers.get(event.payload.session_id);
      if (!handlers) return;
      for (const handler of handlers) handler(event.payload);
    })
      .then((off) => {
        exitStarting = false;
        if (exitHandlers.size === 0) off();
        else exitOff = off;
      })
      .catch((error) => {
        exitStarting = false;
        onError("exit", error);
      });
  };

  const subscribeData = (sessionId: string, handler: Handler<PtyDataPayload>) => {
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
  };

  const subscribeExit = (sessionId: string, handler: Handler<PtyExitPayload>) => {
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
  };

  return { subscribeData, subscribeExit };
}

export const subscribePtyData = (
  sessionId: string,
  handler: Handler<PtyDataPayload>,
): (() => void) =>
  ptyEventMultiplexer.subscribe(sessionId, (envelope) => {
    if (envelope.event.kind !== "data") return;
    handler({
      session_id: envelope.session_id,
      seq: envelope.seq,
      data_b64: envelope.event.data_b64,
    });
  });

export const subscribePtyExit = (
  sessionId: string,
  handler: Handler<PtyExitPayload>,
): (() => void) =>
  ptyEventMultiplexer.subscribe(sessionId, (envelope) => {
    if (envelope.event.kind !== "exit") return;
    handler({
      session_id: envelope.session_id,
      seq: envelope.seq,
      exit_code: envelope.event.exitCode,
      reason: envelope.event.reason,
    });
  });
