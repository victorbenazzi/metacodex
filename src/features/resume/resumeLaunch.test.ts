import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabsStore, WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { openResume } from "@/features/tabs/tabLifecycle";
import type { ResumeEntry } from "./resume.service";

describe("live resume launch", () => {
  beforeEach(() => {
    useTabsStore.setState({ byProject: {} });
  });

  it("focuses an existing live tab without spawning a duplicate", () => {
    const openTab = vi.spyOn(useTabsStore.getState(), "openTab");
    useTabsStore.getState().openTab(WORKSPACE_NULL, {
      id: "live",
      kind: "cli",
      title: "Codex",
      projectId: null,
      cwd: "/tmp",
      cliId: "codex-cli",
      launchCommand: "codex",
      providerSessionId: "provider-1",
    });
    openTab.mockClear();
    const entry: ResumeEntry = {
      id: "resume",
      projectId: null,
      cliId: "codex-cli",
      sessionId: "provider-1",
      cwd: "/tmp",
      branch: null,
      capturedAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-01T00:00:00Z",
      revision: 1,
    };
    openResume(entry);
    expect(openTab).not.toHaveBeenCalled();
    expect(useTabsStore.getState().byProject[WORKSPACE_NULL].activeTabId).toBe("live");
  });
});
