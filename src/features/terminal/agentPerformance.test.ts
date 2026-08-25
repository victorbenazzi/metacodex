// @vitest-environment jsdom

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { performance } from "node:perf_hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { utf8ToBase64 } from "@/lib/base64";

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

import { useAgentStatusStore } from "./agent-status.store";
import { createSessionController, type SessionControllerClock } from "./sessionController";
import { useTerminalStore } from "./terminal.store";

const SESSION_COUNT = 12;
const SAMPLE_COUNT = 1200;

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function terminalHarness() {
  let onInput: (data: string) => void = () => undefined;
  const write = vi.fn();
  const term = {
    rows: 28,
    cols: 100,
    write,
    writeln: vi.fn(),
    onData: vi.fn((listener: (data: string) => void) => {
      onInput = listener;
      return { dispose: vi.fn() };
    }),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as Terminal;
  return { term, write, input: (data: string) => onInput(data) };
}

const clock: SessionControllerClock = {
  nextFrame: async () => undefined,
  now: () => performance.now(),
  setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
  clearInterval: vi.fn(),
  setTimeout: () => 2 as unknown as ReturnType<typeof setTimeout>,
  clearTimeout: vi.fn(),
};

describe("12 session agent performance", () => {
  beforeEach(() => {
    useAgentStatusStore.setState({ byTab: {} });
    useTerminalStore.setState({ sessions: {}, lastFocusedByProject: {} });
  });

  it("12 sessions stay within input and attention latency budgets", async () => {
    let sequence = 0;
    const dataHandlers = new Map<string, (payload: {
      session_id: string;
      seq: number;
      data_b64: string;
    }) => void>();
    const ptyWrite = vi.fn(async () => undefined);
    const controller = createSessionController({
      pty: {
        prepare: async () => ({ sessionId: `session-${++sequence}` }),
        start: async () => undefined,
        kill: async () => undefined,
        write: ptyWrite,
        resize: async () => undefined,
      },
      subscribeData: (sessionId, handler) => {
        dataHandlers.set(sessionId, handler);
        return () => dataHandlers.delete(sessionId);
      },
      subscribeExit: () => () => undefined,
      attachEvents: async () => 0,
      clock,
    });
    const terminals = Array.from({ length: SESSION_COUNT }, terminalHarness);
    const fit = { fit: vi.fn() } as unknown as FitAddon;

    await Promise.all(terminals.map((harness, index) => controller.start({
      tabId: `tab-${index}`,
      projectId: "performance-project",
      cwd: "/performance",
      label: `Agent ${index}`,
      term: harness.term,
      fit,
      getContainer: () => ({ clientWidth: 800 }) as HTMLElement,
      disposed: () => false,
    })));

    const controlledOutput = utf8ToBase64("controlled output\r\n");
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const sessionId = `session-${(index % SESSION_COUNT) + 1}`;
      dataHandlers.get(sessionId)?.({
        session_id: sessionId,
        seq: index + 1,
        data_b64: controlledOutput,
      });
    }
    expect(terminals.reduce((total, harness) => total + harness.write.mock.calls.length, 0))
      .toBe(SAMPLE_COUNT);

    const inputLatencies: number[] = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const started = performance.now();
      terminals[index % SESSION_COUNT].input("x");
      inputLatencies.push(performance.now() - started);
    }
    expect(ptyWrite).toHaveBeenCalledTimes(SAMPLE_COUNT);

    let mutations = 0;
    const unsubscribe = useAgentStatusStore.subscribe(() => {
      mutations += 1;
    });
    for (let index = 0; index < SESSION_COUNT; index += 1) {
      useAgentStatusStore.getState().setStatus(`tab-${index}`, "working");
    }
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      useAgentStatusStore.getState().setStatus(`tab-${index % SESSION_COUNT}`, "working");
    }
    expect(mutations).toBe(SESSION_COUNT);
    const duplicateStatusMutations = mutations;

    const attentionLatencies: number[] = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const id = `tab-${index % SESSION_COUNT}`;
      const started = performance.now();
      useAgentStatusStore.getState().setStatus(id, "needs-attention", undefined, index % 3);
      attentionLatencies.push(performance.now() - started);
      useAgentStatusStore.getState().setStatus(id, "working");
    }
    unsubscribe();

    const inputP95Ms = percentile(inputLatencies, 0.95);
    const attentionP95Ms = percentile(attentionLatencies, 0.95);
    const runningSessionCount = Object.keys(useTerminalStore.getState().sessions).length;

    console.info("agent-performance", JSON.stringify({
      sessions: runningSessionCount,
      outputEvents: SAMPLE_COUNT,
      inputEvents: SAMPLE_COUNT,
      inputP95Ms,
      attentionP95Ms,
      duplicateStatusMutations,
    }));

    expect(runningSessionCount).toBe(SESSION_COUNT);
    expect(inputP95Ms).toBeLessThan(50);
    expect(attentionP95Ms).toBeLessThan(250);

    await Promise.all(terminals.map((_, index) => controller.stop(`tab-${index}`)));
    expect(Object.keys(useTerminalStore.getState().sessions)).toHaveLength(0);
  });
});
