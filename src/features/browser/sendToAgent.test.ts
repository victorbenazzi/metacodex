import { beforeEach, describe, expect, it, vi } from "vitest";

const write = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined));
vi.mock("@/features/terminal/terminal.service", () => ({
  ptyApi: { write },
}));

import { useTabsStore } from "@/components/tabs/tabsStore";
import { useProjectsStore } from "@/features/projects/project.store";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { sendVisualToCli } from "./sendToAgent";

function cliTab(id: string, title: string, cliId: string) {
  return {
    id,
    kind: "cli" as const,
    title,
    projectId: "project",
    cwd: "/project",
    cliId,
    launchCommand: cliId,
  };
}

function cliSession(id: string, tabId: string, title: string) {
  return {
    id,
    tabId,
    projectId: "project",
    cwd: "/project",
    kind: "cli" as const,
    status: "running" as const,
    title,
    createdAt: id,
  };
}

describe("sendVisualToCli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectsStore.setState({ activeProjectId: "project" });
    useTabsStore.setState({
      byProject: {
        project: {
          tabs: [cliTab("tab", "Agent", "codex")],
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
        session: cliSession("session", "tab", "Agent"),
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

  it("sends to the active CLI when another running CLI was focused previously", async () => {
    useTabsStore.setState({
      byProject: {
        project: {
          tabs: [
            cliTab("tab-mcx", "MCX", "mcx"),
            cliTab("tab-claude", "Claude Code", "claude"),
          ],
          activeTabId: "tab-claude",
        },
      },
    });
    useTerminalStore.setState({
      sessions: {
        "session-mcx": cliSession("session-mcx", "tab-mcx", "MCX"),
        "session-claude": cliSession("session-claude", "tab-claude", "Claude Code"),
      },
      lastFocusedByProject: { project: "session-mcx" },
    });

    await expect(sendVisualToCli("context")).resolves.toMatchObject({
      status: "sent",
      sessionId: "session-claude",
      tabId: "tab-claude",
    });
    expect(write).toHaveBeenCalledWith("session-claude", expect.any(String));
  });

  it("does not fall back to another CLI when the active CLI is not running", async () => {
    useTabsStore.setState({
      byProject: {
        project: {
          tabs: [
            cliTab("tab-mcx", "MCX", "mcx"),
            cliTab("tab-claude", "Claude Code", "claude"),
          ],
          activeTabId: "tab-claude",
        },
      },
    });
    useTerminalStore.setState({
      sessions: {
        "session-mcx": cliSession("session-mcx", "tab-mcx", "MCX"),
      },
      lastFocusedByProject: { project: "session-mcx" },
    });

    await expect(sendVisualToCli("context")).resolves.toEqual({ status: "no-cli" });
    expect(write).not.toHaveBeenCalled();
    expect(useTabsStore.getState().byProject.project.activeTabId).toBe("tab-claude");
  });

  it("does not redirect an active terminal selection to another CLI", async () => {
    useTabsStore.setState({
      byProject: {
        project: {
          tabs: [
            {
              id: "tab-terminal",
              kind: "terminal",
              title: "Shell",
              projectId: "project",
              cwd: "/project",
            },
            cliTab("tab-mcx", "MCX", "mcx"),
          ],
          activeTabId: "tab-terminal",
        },
      },
    });
    useTerminalStore.setState({
      sessions: {
        "session-mcx": cliSession("session-mcx", "tab-mcx", "MCX"),
      },
      lastFocusedByProject: { project: "session-mcx" },
    });

    await expect(sendVisualToCli("context")).resolves.toEqual({ status: "no-cli" });
    expect(write).not.toHaveBeenCalled();
  });

  it("reports the normalized write failure and does not activate the tab", async () => {
    write.mockRejectedValueOnce({ code: "Pty", message: "pipe closed" });
    useTerminalStore.setState({
      sessions: {
        session: cliSession("session", "tab", "Agent"),
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
