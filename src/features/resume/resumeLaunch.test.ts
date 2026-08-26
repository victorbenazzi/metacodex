import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabsStore, WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { openResume } from "@/features/tabs/tabLifecycle";
import type { ResumeEntry } from "./resume.service";
import { buildResumeTab, resumeHistoryLabel } from "./resumeLaunch";

function entry(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    id: "resume",
    projectId: "project-1",
    cliId: "codex-cli",
    sessionId: "019dd4bf-0929-7ea0-b227-1f51085e7d71",
    cwd: "/tmp",
    branch: "main",
    capturedAt: "2026-01-01T00:00:00Z",
    lastSeenAt: "2026-01-01T00:00:00Z",
    revision: 1,
    ...overrides,
  };
}

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
    const liveEntry: ResumeEntry = {
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
    openResume(liveEntry);
    expect(openTab).not.toHaveBeenCalled();
    expect(useTabsStore.getState().byProject[WORKSPACE_NULL].activeTabId).toBe("live");
  });
});

describe("buildResumeTab", () => {
  it("resumes Codex via the resume subcommand, not --resume", () => {
    const tab = buildResumeTab(entry());
    expect(tab?.launchArgs).toEqual(["resume", "019dd4bf-0929-7ea0-b227-1f51085e7d71"]);
    expect(tab?.launchCommand).toBe("codex resume '019dd4bf-0929-7ea0-b227-1f51085e7d71'");
    expect(tab?.launchCommand).not.toContain("--resume");
  });

  it("resumes Claude Code via --resume", () => {
    const tab = buildResumeTab(
      entry({ cliId: "claude-code", sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }),
    );
    expect(tab?.launchArgs).toEqual(["--resume", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]);
    expect(tab?.launchCommand).toContain("--resume");
  });

  it("resumes OpenCode via --session", () => {
    const tab = buildResumeTab(entry({ cliId: "opencode", sessionId: "ses_abc123" }));
    expect(tab?.launchArgs).toEqual(["--session", "ses_abc123"]);
    expect(tab?.launchCommand).toContain("--session");
  });
});

describe("resumeHistoryLabel", () => {
  it("uses the CLI name plus branch instead of the branch alone", () => {
    expect(resumeHistoryLabel(entry())).toBe("Codex CLI · main");
  });

  it("falls back to the CLI name when no branch was captured", () => {
    expect(resumeHistoryLabel(entry({ branch: null }))).toBe("Codex CLI");
  });
});
