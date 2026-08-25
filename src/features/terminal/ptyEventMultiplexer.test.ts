import { describe, expect, it, vi } from "vitest";

import { EV, type EventName, type PtyDataPayload } from "@/lib/events";
import {
  createPtyEventMultiplexer,
  fromBackendEnvelope,
  type PtyEventEnvelope,
  type PtyReplayAdapter,
} from "./ptyEventMultiplexer";

type EventHandler = (event: { payload: unknown }) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function dataEnvelope(seq: number, data = String(seq)): PtyEventEnvelope {
  return {
    session_id: "session-1",
    seq,
    event: { kind: "data", data_b64: data },
  };
}

function listenerHarness(replay: PtyReplayAdapter = async () => []) {
  const handlers = new Map<EventName, EventHandler>();
  const off = vi.fn();
  const calls: EventName[] = [];
  const diagnostics = vi.fn();
  const multiplexer = createPtyEventMultiplexer({
    listen: async <T>(event: EventName, handler: (event: { payload: T }) => void) => {
      calls.push(event);
      handlers.set(event, handler as EventHandler);
      return off;
    },
    replay,
    diagnostic: diagnostics,
  });
  const emitData = (seq: number, data = String(seq)) => {
    handlers.get(EV.ptyData)?.({
      payload: {
        session_id: "session-1",
        seq,
        data_b64: data,
      } satisfies PtyDataPayload,
    });
  };
  return { calls, diagnostics, emitData, multiplexer, off };
}

describe("global sequenced PTY event multiplexer", () => {
  it("converts retained backend envelopes into the live event contract", () => {
    expect(
      fromBackendEnvelope({
        sessionId: "session-1",
        seq: 3,
        event: { type: "exit", exit_code: 0, reason: "normal" },
      }),
    ).toEqual({
      session_id: "session-1",
      seq: 3,
      event: { kind: "exit", exitCode: 0, reason: "normal" },
    });
  });

  it("installs each global listener exactly once", async () => {
    const { calls, multiplexer } = listenerHarness();

    await Promise.all([multiplexer.ensureReady(), multiplexer.ensureReady()]);

    expect(calls).toEqual([EV.ptyData, EV.ptyBackpressure, EV.ptyExit]);
  });

  it("merges replay and live events exactly once in sequence", async () => {
    const replayResult = deferred<PtyEventEnvelope[]>();
    const { emitData, multiplexer } = listenerHarness(async () => replayResult.promise);
    const received: number[] = [];
    await multiplexer.ensureReady();
    multiplexer.subscribe("session-1", (envelope) => received.push(envelope.seq));

    const attaching = multiplexer.attach("session-1", 0);
    emitData(2);
    replayResult.resolve([dataEnvelope(1), dataEnvelope(2)]);
    await attaching;

    expect(received).toEqual([1, 2]);
    expect(multiplexer.lastSequence("session-1")).toBe(2);
  });

  it("discards duplicate and old envelopes", async () => {
    const { emitData, multiplexer } = listenerHarness();
    const received: number[] = [];
    await multiplexer.ensureReady();
    multiplexer.subscribe("session-1", (envelope) => received.push(envelope.seq));

    emitData(1);
    emitData(1, "duplicate");
    emitData(2);

    expect(received).toEqual([1, 2]);
  });

  it("detects a gap and requests replay from the last consumed sequence", async () => {
    const replay = vi.fn<PtyReplayAdapter>(async (_sessionId, afterSeq) => {
      expect(afterSeq).toBe(0);
      return [dataEnvelope(1)];
    });
    const { diagnostics, emitData, multiplexer } = listenerHarness(replay);
    const received: number[] = [];
    await multiplexer.ensureReady();
    multiplexer.subscribe("session-1", (envelope) => received.push(envelope.seq));

    emitData(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(replay).toHaveBeenCalledWith("session-1", 0);
    expect(diagnostics).toHaveBeenCalledWith({
      code: "sequence_gap",
      sessionId: "session-1",
      expectedSeq: 1,
      receivedSeq: 2,
    });
    expect(received).toEqual([1, 2]);
  });

  it("keeps global listeners installed after per-session cleanup", async () => {
    const { multiplexer, off } = listenerHarness();
    await multiplexer.ensureReady();

    const unsubscribe = multiplexer.subscribe("session-1", vi.fn());
    unsubscribe();

    expect(off).not.toHaveBeenCalled();
  });

  it("rejects readiness when any listener installation fails", async () => {
    const failure = new Error("listener failed");
    const diagnostics = vi.fn();
    const multiplexer = createPtyEventMultiplexer({
      listen: () => Promise.reject(failure),
      replay: async () => [],
      diagnostic: diagnostics,
    });

    await expect(multiplexer.ensureReady()).rejects.toBe(failure);
    expect(diagnostics).toHaveBeenCalledWith({
      code: "listener_install_failed",
      error: failure,
    });
  });
});
