// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TerminalRuntimeState } from "@/features/terminal/terminal.types";

const mocks = vi.hoisted(() => {
  let listener: ((state: TerminalRuntimeState) => void) | null = null;
  const term = {
    registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
    attachCustomKeyEventHandler: vi.fn(),
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    clearSelection: vi.fn(),
    paste: vi.fn(),
  };
  return {
    closeTab: vi.fn(),
    copy: vi.fn(async () => undefined),
    start: vi.fn(async () => {
      listener?.({
        phase: "failed",
        step: "prepare",
        error: { code: "Pty", message: "spawn failed" },
        retryable: true,
      });
    }),
    stop: vi.fn(async () => undefined),
    subscribe: vi.fn((_tabId: string, next: (state: TerminalRuntimeState) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
    term,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { step?: string }) => values?.step
      ? `${key}:${values.step}`
      : key,
  }),
}));
vi.mock("./useXterm", () => ({
  useXterm: () => ({
    containerRef: { current: null },
    termRef: { current: mocks.term },
    fitRef: { current: { fit: vi.fn() } },
    disposedRef: { current: false },
  }),
}));
vi.mock("@/features/terminal/sessionController", () => ({
  sessionController: {
    start: mocks.start,
    stop: mocks.stop,
    subscribe: mocks.subscribe,
    getSessionId: vi.fn(() => null),
  },
}));
vi.mock("@/features/resume/useSessionCapture", () => ({ useSessionCapture: vi.fn() }));
vi.mock("./terminalLinks", () => ({ createFileLinkProvider: vi.fn(() => ({})) }));
vi.mock("@/features/terminal/fitOnVisible", () => ({
  applyTerminalFit: vi.fn(),
  runFitOnVisible: vi.fn(() => undefined),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(async () => ""),
  writeText: mocks.copy,
}));
vi.mock("@/features/tabs/tabLifecycle", () => ({ requestCloseTab: mocks.closeTab }));

import { TerminalTab } from "./TerminalTab";

describe("TerminalTab failure recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it("renders phase error and retries startup in the same tab", async () => {
    render(
      <TerminalTab
        tabId="tab-1"
        cwd="/project"
        projectId="project-1"
        label="Shell"
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Pty: spawn failed");
    expect(screen.getByRole("alert")).toHaveTextContent("terminal.failure.steps.prepare");

    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));

    fireEvent.click(
      screen.getByRole("button", { name: "terminal.failure.copyDiagnostics" }),
    );
    expect(mocks.copy).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "tabs.closeTab" }));
    expect(mocks.closeTab).toHaveBeenCalledWith("project-1", "tab-1");
  });
});
