import { beforeEach, describe, expect, it, vi } from "vitest";

const write = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined));
vi.mock("@/features/terminal/terminal.service", () => ({
  ptyApi: { write },
}));

import { useTabsStore } from "@/components/tabs/tabsStore";
import { useProjectsStore } from "@/features/projects/project.store";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { sendVisualToCli } from "./sendToAgent";

describe("sendVisualToCli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectsStore.setState({ activeProjectId: "project" });
    useTabsStore.setState({
      byProject: {
        project: {
          tabs: [
            {
              id: "tab",
              kind: "cli",
              title: "Agent",
              projectId: "project",
              cwd: "/project",
              cliId: "codex",
              launchCommand: "codex",
            },
          ],
          activeTabId: null,
        },
      },
    });
    useTerminalStore.setState({ sessions: {}, lastFocusedByProject: {} });
  });

  it("reports sent only after PTY write resolves", async () => {
    let release: (() => void) | undefined;
    write.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    useTerminalStore.setState({
      sessions: {
        session: {
          id: "session",
          tabId: "tab",
          projectId: "project",
          cwd: "/project",
          kind: "cli",
          status: "running",
          title: "Agent",
          createdAt: "now",
        },
      },
      lastFocusedByProject: { project: "session" },
    });
    const pending = sendVisualToCli("context");
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release?.();
    await expect(pending).resolves.toMatchObject({ status: "sent", sessionId: "session" });
    expect(useTabsStore.getState().byProject.project.activeTabId).toBe("tab");
  });

  it("reports the normalized write failure and does not activate the tab", async () => {
    write.mockRejectedValueOnce({ code: "Pty", message: "pipe closed" });
    useTerminalStore.setState({
      sessions: {
        session: {
          id: "session",
          tabId: "tab",
          projectId: "project",
          cwd: "/project",
          kind: "cli",
          status: "running",
          title: "Agent",
          createdAt: "now",
        },
      },
      lastFocusedByProject: { project: "session" },
    });
    await expect(sendVisualToCli("context")).resolves.toEqual({
      status: "failed",
      error: { code: "Pty", message: "pipe closed" },
    });
    expect(useTabsStore.getState().byProject.project.activeTabId).toBeNull();
  });
});
