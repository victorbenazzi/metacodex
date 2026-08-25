// @vitest-environment jsdom

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";

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

import { createSessionController, type SessionControllerClock } from "./sessionController";
import { useTerminalStore } from "./terminal.store";

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

const clock: SessionControllerClock = {
  nextFrame: async () => undefined,
  now: () => 1,
  setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
  clearInterval: vi.fn(),
  setTimeout: () => 2 as unknown as ReturnType<typeof setTimeout>,
  clearTimeout: vi.fn(),
};

describe("PTY lifecycle reliability stress", () => {
  it(
    "completes 10000 lifecycle iterations without loss duplicate or residual session",
    async () => {
      useTerminalStore.setState({ sessions: {}, lastFocusedByProject: {} });
      type Scenario = "normal" | "immediate-stop" | "fast-exit";
      let sequence = 0;
      let scenario: Scenario = "normal";
      let resolvePrepare: ((value: { sessionId: string }) => void) | null = null;
      const killed = new Set<string>();
      const scenarioBySession = new Map<string, Scenario>();
      const dataListeners = new Map<string, (payload: {
        session_id: string;
        seq: number;
        data_b64: string;
      }) => void>();
      const exitListeners = new Map<string, (payload: {
        session_id: string;
        seq: number;
        exit_code: number;
        reason: "normal";
      }) => void>();
      let attachedCount = 0;
      let fastExitCount = 0;
      const controller = createSessionController({
        pty: {
          prepare: async () => {
            const sessionId = `session-${++sequence}`;
            scenarioBySession.set(sessionId, scenario);
            if (scenario !== "immediate-stop") return { sessionId };
            return new Promise<{ sessionId: string }>((resolve) => {
              resolvePrepare = resolve;
            });
          },
          start: async (sessionId) => {
            if (scenarioBySession.get(sessionId) !== "fast-exit") return;
            fastExitCount += 1;
            exitListeners.get(sessionId)?.({
              session_id: sessionId,
              seq: 2,
              exit_code: 0,
              reason: "normal",
            });
          },
          kill: async (sessionId) => {
            expect(killed.has(sessionId)).toBe(false);
            killed.add(sessionId);
          },
          write: async () => undefined,
          resize: async () => undefined,
        },
        subscribeData: (sessionId, listener) => {
          dataListeners.set(sessionId, listener);
          return () => dataListeners.delete(sessionId);
        },
        subscribeExit: (sessionId, listener) => {
          exitListeners.set(sessionId, listener);
          return () => exitListeners.delete(sessionId);
        },
        attachEvents: async (sessionId) => {
          attachedCount += 1;
          dataListeners.get(sessionId)?.({
            session_id: sessionId,
            seq: 1,
            data_b64: "aW5pdGlhbCBvdXRwdXQ=",
          });
          return 1;
        },
        clock,
      });
      const term = fakeTerminal();
      const fit = { fit: vi.fn() } as unknown as FitAddon;

      for (let iteration = 0; iteration < 10_000; iteration += 1) {
        scenario = iteration % 4 === 1
          ? "immediate-stop"
          : iteration % 4 === 2
            ? "fast-exit"
            : "normal";
        const start = controller.start({
          tabId: "stress-tab",
          projectId: "stress-project",
          cwd: "/stress",
          label: "Stress",
          term,
          fit,
          getContainer: () => ({ clientWidth: 800 }) as HTMLElement,
          disposed: () => false,
        });

        if (scenario === "immediate-stop") {
          while (resolvePrepare === null) await Promise.resolve();
          const stop = controller.stop("stress-tab");
          const resolve = resolvePrepare as ((value: { sessionId: string }) => void) | null;
          resolvePrepare = null;
          if (!resolve) throw new Error("prepare resolver missing");
          resolve({ sessionId: `session-${iteration + 1}` });
          await Promise.all([start, stop]);
          expect(controller.getSessionId("stress-tab")).toBeNull();
          continue;
        }

        await start;
        expect(controller.getSessionId("stress-tab")).toBe(`session-${iteration + 1}`);
        await controller.stop("stress-tab");
      }

      expect(sequence).toBe(10_000);
      expect(killed.size).toBe(10_000);
      expect(attachedCount).toBe(7_500);
      expect(fastExitCount).toBe(2_500);
      expect(term.write).toHaveBeenCalledTimes(7_500);
      expect(term.writeln).toHaveBeenCalledTimes(2_500);
      expect(controller.getSessionId("stress-tab")).toBeNull();
      expect(dataListeners.size).toBe(0);
      expect(exitListeners.size).toBe(0);
      expect(Object.keys(useTerminalStore.getState().sessions)).toHaveLength(0);
    },
    30_000,
  );
});
