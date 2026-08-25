import { describe, expect, it, vi } from "vitest";

import { EV, type EventName, type PtyDataPayload, type PtyExitPayload } from "@/lib/events";
import { createPtyEventSubscriptions } from "./ptyEvents";

type Envelope<T> = { payload: T };

describe("PTY event subscriptions", () => {
  it("installs one listener per event and routes payloads by session", async () => {
    const listeners = new Map<EventName, (event: Envelope<unknown>) => void>();
    const listenCalls: EventName[] = [];
    const offData = vi.fn();
    const offExit = vi.fn();
    const listen = async <T>(
      event: EventName,
      handler: (event: Envelope<T>) => void,
    ): Promise<() => void> => {
      listenCalls.push(event);
      listeners.set(event, handler as (event: Envelope<unknown>) => void);
      return event === EV.ptyData ? offData : offExit;
    };
    const hub = createPtyEventSubscriptions(listen);
    const onData = vi.fn();
    const onExit = vi.fn();

    const unsubscribeData = hub.subscribeData("session-1", onData);
    const unsubscribeExit = hub.subscribeExit("session-1", onExit);
    await Promise.resolve();

    listeners.get(EV.ptyData)?.({
      payload: { session_id: "session-1", seq: 1, data_b64: "YQ==" } satisfies PtyDataPayload,
    });
    listeners.get(EV.ptyExit)?.({
      payload: {
        session_id: "session-1",
        seq: 2,
        exit_code: 0,
        reason: "normal",
      } satisfies PtyExitPayload,
    });

    expect(listenCalls).toEqual([EV.ptyData, EV.ptyExit]);
    expect(onData).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledOnce();

    unsubscribeData();
    unsubscribeExit();
    expect(offData).toHaveBeenCalledOnce();
    expect(offExit).toHaveBeenCalledOnce();
  });

  it("reports listener installation failure through the injected diagnostic seam", async () => {
    const failure = new Error("listen failed");
    const onError = vi.fn();
    const hub = createPtyEventSubscriptions(() => Promise.reject(failure), onError);

    hub.subscribeData("session-1", vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith("data", failure);
  });
});
