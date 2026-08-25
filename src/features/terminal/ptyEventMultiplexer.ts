import {
  EV,
  listenTo,
  type PtyBackpressurePayload,
  type PtyDataPayload,
  type PtyExitPayload,
  type PtyExitReason,
} from "@/lib/events";
import { ptyApi } from "@/features/terminal/terminal.service";
import type { PtyBackendEventEnvelope } from "@/features/terminal/terminal.types";

export type PtyMultiplexedEvent =
  | { kind: "data"; data_b64: string }
  | { kind: "backpressure"; queueDepth: number; stalledMs: number }
  | { kind: "exit"; exitCode: number; reason: PtyExitReason };

export type PtyEventEnvelope = {
  session_id: string;
  seq: number;
  event: PtyMultiplexedEvent;
};

type Consumer = (envelope: PtyEventEnvelope) => void;
type Unlisten = () => void;
type Listener = <T>(
  event: (typeof EV)[keyof typeof EV],
  handler: (event: { payload: T }) => void,
) => Promise<Unlisten>;

export type PtyReplayAdapter = (
  sessionId: string,
  afterSeq: number,
) => Promise<PtyEventEnvelope[]>;

export type PtyEventDiagnostic = {
  code: "listener_install_failed" | "sequence_gap" | "buffer_overflow" | "replay_failed";
  sessionId?: string;
  expectedSeq?: number;
  receivedSeq?: number;
  error?: unknown;
};

export type PtyEventMultiplexer = {
  ensureReady(): Promise<void>;
  subscribe(sessionId: string, consumer: Consumer): Unlisten;
  attach(sessionId: string, afterSeq?: number): Promise<number>;
  lastSequence(sessionId: string): number;
};

const MAX_BUFFERED_ENVELOPES = 2_048;

type SessionRoute = {
  consumers: Set<Consumer>;
  lastSeq: number;
  replaying: boolean;
  buffered: Map<number, PtyEventEnvelope>;
};

function sessionIdForBackpressure(payload: PtyBackpressurePayload): string {
  return payload.sessionId;
}

export function createPtyEventMultiplexer(deps: {
  listen: Listener;
  replay: PtyReplayAdapter;
  diagnostic?: (diagnostic: PtyEventDiagnostic) => void;
}): PtyEventMultiplexer {
  const routes = new Map<string, SessionRoute>();
  let ready: Promise<void> | null = null;

  const routeFor = (sessionId: string): SessionRoute => {
    const existing = routes.get(sessionId);
    if (existing) return existing;
    const route: SessionRoute = {
      consumers: new Set(),
      lastSeq: 0,
      replaying: false,
      buffered: new Map(),
    };
    routes.set(sessionId, route);
    return route;
  };

  const buffer = (route: SessionRoute, envelope: PtyEventEnvelope) => {
    if (envelope.seq <= route.lastSeq) return;
    route.buffered.set(envelope.seq, envelope);
    if (route.buffered.size <= MAX_BUFFERED_ENVELOPES) return;
    const newest = Math.max(...route.buffered.keys());
    route.buffered.delete(newest);
    deps.diagnostic?.({
      code: "buffer_overflow",
      sessionId: envelope.session_id,
      receivedSeq: envelope.seq,
    });
  };

  const deliverContiguous = (route: SessionRoute) => {
    if (route.consumers.size === 0) return;
    while (true) {
      const next = route.buffered.get(route.lastSeq + 1);
      if (!next) break;
      route.buffered.delete(next.seq);
      route.lastSeq = next.seq;
      for (const consumer of route.consumers) consumer(next);
    }
  };

  const replayFromLast = async (sessionId: string, route: SessionRoute) => {
    if (route.replaying) return;
    route.replaying = true;
    try {
      const replay = await deps.replay(sessionId, route.lastSeq);
      for (const envelope of replay) buffer(route, envelope);
      deliverContiguous(route);
    } catch (error) {
      deps.diagnostic?.({ code: "replay_failed", sessionId, error });
      throw error;
    } finally {
      route.replaying = false;
    }
  };

  const accept = (envelope: PtyEventEnvelope) => {
    const route = routeFor(envelope.session_id);
    if (envelope.seq <= route.lastSeq) return;
    buffer(route, envelope);
    if (route.replaying) return;
    if (envelope.seq > route.lastSeq + 1) {
      deps.diagnostic?.({
        code: "sequence_gap",
        sessionId: envelope.session_id,
        expectedSeq: route.lastSeq + 1,
        receivedSeq: envelope.seq,
      });
      void replayFromLast(envelope.session_id, route).catch(() => undefined);
      return;
    }
    deliverContiguous(route);
  };

  const ensureReady = (): Promise<void> => {
    if (ready) return ready;
    ready = Promise.all([
      deps.listen<PtyDataPayload>(EV.ptyData, ({ payload }) => {
        accept({
          session_id: payload.session_id,
          seq: payload.seq,
          event: { kind: "data", data_b64: payload.data_b64 },
        });
      }),
      deps.listen<PtyBackpressurePayload>(EV.ptyBackpressure, ({ payload }) => {
        const sessionId = sessionIdForBackpressure(payload);
        accept({
          session_id: sessionId,
          seq: payload.seq,
          event: {
            kind: "backpressure",
            queueDepth: payload.queueDepth,
            stalledMs: payload.stalledMs,
          },
        });
      }),
      deps.listen<PtyExitPayload>(EV.ptyExit, ({ payload }) => {
        accept({
          session_id: payload.session_id,
          seq: payload.seq,
          event: {
            kind: "exit",
            exitCode: payload.exit_code,
            reason: payload.reason,
          },
        });
      }),
    ])
      .then(() => undefined)
      .catch((error) => {
        ready = null;
        deps.diagnostic?.({ code: "listener_install_failed", error });
        throw error;
      });
    return ready;
  };

  const subscribe = (sessionId: string, consumer: Consumer): Unlisten => {
    const route = routeFor(sessionId);
    route.consumers.add(consumer);
    deliverContiguous(route);
    return () => {
      route.consumers.delete(consumer);
      if (route.consumers.size === 0 && !route.replaying && route.buffered.size === 0) {
        routes.delete(sessionId);
      }
    };
  };

  const attach = async (sessionId: string, afterSeq = 0): Promise<number> => {
    const route = routeFor(sessionId);
    route.lastSeq = Math.max(route.lastSeq, afterSeq);
    await replayFromLast(sessionId, route);
    return route.lastSeq;
  };

  return {
    ensureReady,
    subscribe,
    attach,
    lastSequence: (sessionId) => routes.get(sessionId)?.lastSeq ?? 0,
  };
}

export function fromBackendEnvelope(envelope: PtyBackendEventEnvelope): PtyEventEnvelope {
  const base = { session_id: envelope.sessionId, seq: envelope.seq };
  switch (envelope.event.type) {
    case "data":
      return { ...base, event: { kind: "data", data_b64: envelope.event.data_b64 } };
    case "backpressure":
      return {
        ...base,
        event: {
          kind: "backpressure",
          queueDepth: envelope.event.queue_depth,
          stalledMs: envelope.event.stalled_ms,
        },
      };
    case "exit":
      return {
        ...base,
        event: {
          kind: "exit",
          exitCode: envelope.event.exit_code,
          reason: envelope.event.reason as PtyExitReason,
        },
      };
  }
}

export const ptyEventMultiplexer = createPtyEventMultiplexer({
  listen: listenTo,
  replay: async (sessionId, afterSeq) => {
    const response = await ptyApi.attach(sessionId, afterSeq);
    return response.events.map(fromBackendEnvelope);
  },
});
