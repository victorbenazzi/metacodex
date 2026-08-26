// @vitest-environment jsdom

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/terminal/oscHandlers", () => ({
  installOscHandlers: () => [],
}));
vi.mock("@/features/terminal/agentHeuristic", () => ({
  createAgentHeuristic: () => ({ dispose: vi.fn() }),
}));
vi.mock("@/features/terminal/notificationDispatch", () => ({
  dispatchAgentNotification: vi.fn(),
}));
vi.mock("./fitOnVisible", () => ({
  applyTerminalFit: vi.fn(),
}));

import {
  createSessionController,
  type PtyIo,
  type SessionControllerClock,
  type StartArgs,
} from "./sessionController";
import type { PtyDataPayload, PtyExitPayload } from "@/lib/events";
import { useTerminalStore } from "./terminal.store";
import { useAgentStatusStore } from "./agent-status.store";

type Handler<T> = (payload: T) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function fakeTerminal(): Terminal {
  return {
    rows: 28,
    cols: 100,
    write: vi.fn(),
    writeln: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as Terminal;
}

function immediateClock(): SessionControllerClock {
  return {
    nextFrame: async () => undefined,
    now: () => 1_000,
    setInterval: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>),
    clearInterval: vi.fn(),
    setTimeout: vi.fn(() => 2 as unknown as ReturnType<typeof setTimeout>),
    clearTimeout: vi.fn(),
  };
}

function startArgs(overrides: Partial<StartArgs> = {}): StartArgs {
  return {
    tabId: "tab-1",
    projectId: "project-1",
    cwd: "/project",
    label: "Shell",
    term: fakeTerminal(),
    fit: { fit: vi.fn() } as unknown as FitAddon,
    getContainer: () => ({ clientWidth: 800 }) as HTMLElement,
    disposed: () => false,
    ...overrides,
  };
}

function harness(ptyOverrides: Partial<PtyIo> = {}) {
  const dataHandlers = new Map<string, Handler<PtyDataPayload>>();
  const exitHandlers = new Map<string, Handler<PtyExitPayload>>();
  const pty: PtyIo = {
    prepare: vi.fn(async () => ({ sessionId: "session-1" })),
    start: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    ...ptyOverrides,
  };
  const diagnostics = vi.fn();
  const attachEvents = vi.fn(async () => 0);
  const controller = createSessionController({
    pty,
    subscribeData: (sessionId, handler) => {
      dataHandlers.set(sessionId, handler);
      return () => dataHandlers.delete(sessionId);
    },
    subscribeExit: (sessionId, handler) => {
      exitHandlers.set(sessionId, handler);
      return () => exitHandlers.delete(sessionId);
    },
    attachEvents,
    clock: immediateClock(),
    diagnostics,
  });
  return { attachEvents, controller, dataHandlers, diagnostics, exitHandlers, pty };
}

describe("session controller characterization", () => {
  beforeEach(() => {
    useTerminalStore.setState({ sessions: {}, lastFocusedByProject: {} });
    useAgentStatusStore.setState({ byTab: {} });
  });

  it("starts one session and stops it idempotently", async () => {
    const { controller, pty } = harness();
    const onSession = vi.fn();

    await controller.start(startArgs({ onSession }));

    expect(controller.getSessionId("tab-1")).toBe("session-1");
    expect(onSession).toHaveBeenLastCalledWith("session-1");
    expect(useTerminalStore.getState().sessions["session-1"]?.status).toBe("running");

    await controller.stop("tab-1");
    await controller.stop("tab-1");

    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(controller.getSessionId("tab-1")).toBeNull();
  });

  it("attaches subscribed consumers before authorizing child start", async () => {
    const { attachEvents, controller, dataHandlers, exitHandlers, pty } = harness();

    await controller.start(startArgs());

    expect(dataHandlers.has("session-1")).toBe(true);
    expect(exitHandlers.has("session-1")).toBe(true);
    expect(attachEvents).toHaveBeenCalledWith("session-1", 0);
    expect(attachEvents.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(pty.start).mock.invocationCallOrder[0],
    );
  });

  it("routes data and normal exit to the active terminal", async () => {
    const { controller, dataHandlers, exitHandlers } = harness();
    const term = fakeTerminal();

    await controller.start(startArgs({ term }));
    dataHandlers.get("session-1")?.({
      session_id: "session-1",
      seq: 1,
      data_b64: "aGVsbG8=",
    });
    exitHandlers.get("session-1")?.({
      session_id: "session-1",
      seq: 2,
      exit_code: 0,
      reason: "normal",
    });

    expect(term.write).toHaveBeenCalledOnce();
    expect(term.writeln).toHaveBeenCalledOnce();
    expect(useTerminalStore.getState().sessions["session-1"]?.status).toBe("exited");
  });

  it("reports prepare failure through the diagnostic seam", async () => {
    const failure = { code: "spawn_failed", message: "failed" };
    const { controller, diagnostics } = harness({
      prepare: vi.fn(async () => Promise.reject(failure)),
    });

    await controller.start(startArgs());

    expect(diagnostics).toHaveBeenCalledWith("prepare", failure, {
      tabId: "tab-1",
      sessionId: null,
    });
    expect(controller.getSessionId("tab-1")).toBeNull();
  });

  it("immediate stop leaves no late-spawned session", async () => {
    const prepareStarted = deferred<void>();
    const prepareResult = deferred<{ sessionId: string }>();
    const { controller, pty } = harness({
      prepare: vi.fn(async () => {
        prepareStarted.resolve();
        return prepareResult.promise;
      }),
    });

    const starting = controller.start(startArgs());
    await prepareStarted.promise;
    const stopping = controller.stop("tab-1");
    prepareResult.resolve({ sessionId: "session-1" });
    await Promise.all([starting, stopping]);

    expect(controller.getSessionId("tab-1")).toBeNull();
    expect(pty.kill).toHaveBeenCalledWith("session-1");
  });

  it("leaves exactly one final session after start stop start", async () => {
    const firstPrepareStarted = deferred<void>();
    const firstPrepareResult = deferred<{ sessionId: string }>();
    let prepareCount = 0;
    const { controller, pty } = harness({
      prepare: vi.fn(async () => {
        prepareCount += 1;
        if (prepareCount === 1) {
          firstPrepareStarted.resolve();
          return firstPrepareResult.promise;
        }
        return { sessionId: "session-2" };
      }),
    });

    const firstStart = controller.start(startArgs());
    await firstPrepareStarted.promise;
    const stop = controller.stop("tab-1");
    const finalStart = controller.start(startArgs());
    firstPrepareResult.resolve({ sessionId: "session-1" });
    await Promise.all([firstStart, stop, finalStart]);

    expect(pty.kill).toHaveBeenCalledWith("session-1");
    expect(controller.getSessionId("tab-1")).toBe("session-2");
    expect(useTerminalStore.getState().sessions["session-1"]).toBeUndefined();
    expect(useTerminalStore.getState().sessions["session-2"]?.status).toBe("running");
  });

  it("handles StrictMode-like start cleanup start without duplicate ownership", async () => {
    const { controller, pty } = harness({
      prepare: vi
        .fn<() => Promise<{ sessionId: string }>>()
        .mockResolvedValueOnce({ sessionId: "session-1" })
        .mockResolvedValueOnce({ sessionId: "session-2" }),
    });

    await controller.start(startArgs());
    await controller.stop("tab-1");
    await controller.start(startArgs());

    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(pty.kill).toHaveBeenCalledWith("session-1");
    expect(controller.getSessionId("tab-1")).toBe("session-2");
  });

  it("delivers an exit emitted before start returns", async () => {
    let emitEarlyExit: (() => void) | undefined;
    const onExit = vi.fn();
    const { controller, exitHandlers } = harness({
      start: vi.fn(async () => {
        emitEarlyExit?.();
      }),
    });
    emitEarlyExit = () => {
      exitHandlers.get("session-1")?.({
        session_id: "session-1",
        seq: 1,
        exit_code: 1,
        reason: "normal",
      });
    };

    await controller.start(startArgs({ onExit }));

    expect(onExit).toHaveBeenCalledWith({ code: 1, reason: "normal" });
  });

  it("does not spawn when global listener installation fails", async () => {
    const pty: PtyIo = {
      prepare: vi.fn(async () => ({ sessionId: "session-1" })),
      start: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
    };
    const failure = new Error("listener failed");
    const diagnostics = vi.fn();
    const controller = createSessionController({
      pty,
      subscribeData: () => () => undefined,
      subscribeExit: () => () => undefined,
      ensureListeners: async () => Promise.reject(failure),
      attachEvents: async () => 0,
      clock: immediateClock(),
      diagnostics,
    });

    await controller.start(startArgs());

    expect(pty.prepare).not.toHaveBeenCalled();
    expect(diagnostics).toHaveBeenCalledWith("listeners", {
      code: "Error",
      message: "listener failed",
    }, {
      tabId: "tab-1",
      sessionId: null,
    });
    expect(controller.getState("tab-1")).toEqual({
      phase: "failed",
      step: "listeners",
      error: { code: "Error", message: "listener failed" },
      retryable: true,
    });
  });

  it("publishes a failed state and retries with one new lifecycle revision", async () => {
    const prepare = vi
      .fn<() => Promise<{ sessionId: string }>>()
      .mockRejectedValueOnce({ code: "Pty", message: "spawn failed" })
      .mockResolvedValueOnce({ sessionId: "session-2" });
    const { controller, pty } = harness({ prepare });
    const states: string[] = [];
    const unsubscribe = controller.subscribe("tab-1", (state) => states.push(state.phase));

    await controller.start(startArgs());
    await controller.start(startArgs());
    unsubscribe();

    expect(states).toContain("failed");
    expect(controller.getState("tab-1")).toEqual({
      phase: "running",
      sessionId: "session-2",
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(pty.start).toHaveBeenCalledTimes(1);
  });

  it("does not diagnose resize NotFound after the child has already gone", async () => {
    const { controller, diagnostics } = harness({
      resize: vi.fn(async () =>
        Promise.reject({ code: "NotFound", message: "pty session session-1" }),
      ),
    });

    await controller.start(startArgs());

    expect(diagnostics).not.toHaveBeenCalledWith(
      "resize",
      expect.anything(),
      expect.anything(),
    );
  });

  it("ignores onResize after a normal exit", async () => {
    let onResize: ((size: { rows: number; cols: number }) => void) | undefined;
    const term = fakeTerminal();
    term.onResize = vi.fn((handler) => {
      onResize = handler;
      return { dispose: vi.fn() };
    });
    const { controller, diagnostics, exitHandlers, pty } = harness();

    await controller.start(startArgs({ term }));
    exitHandlers.get("session-1")?.({
      session_id: "session-1",
      seq: 2,
      exit_code: 2,
      reason: "normal",
    });
    vi.mocked(pty.resize).mockClear();
    onResize?.({ rows: 32, cols: 120 });
    await Promise.resolve();

    expect(pty.resize).not.toHaveBeenCalled();
    expect(diagnostics).not.toHaveBeenCalledWith(
      "resize",
      expect.anything(),
      expect.anything(),
    );
  });
});

