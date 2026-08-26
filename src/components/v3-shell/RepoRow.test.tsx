// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

import { useTabsStore } from "@/components/tabs/tabsStore";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { useProjectsStore } from "@/features/projects/project.store";
import { useResumeStore } from "@/features/resume/resume.store";
import { useAgentStatusStore } from "@/features/terminal/agent-status.store";
import { useCodeSidebarStore } from "@/features/ui/codeSidebar.store";
import type { Project } from "@/features/projects/project.types";
import { RepoRow } from "./RepoRow";

const project: Project = {
  id: "project-a",
  name: "Project A",
  path: "/project-a",
  color: "#000000",
  createdAt: "2026-01-01T00:00:00Z",
  lastOpenedAt: "2026-01-01T00:00:00Z",
};

function renderRepoRow() {
  return render(
    <TooltipProvider>
      <RepoRow
        project={project}
        active
        onRequestRename={vi.fn()}
        onRequestRemove={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe("RepoRow agent activity", () => {
  beforeEach(() => {
    useProjectsStore.setState({ projects: [project], activeProjectId: project.id });
    useCodeSidebarStore.setState({ expandedProjects: { [project.id]: true } });
    useResumeStore.setState({ entries: [], hydrated: true });
    useTabsStore.setState({
      byProject: {
        [project.id]: {
          activeTabId: "agent-a",
          tabs: [
            {
              id: "agent-a",
              kind: "cli",
              title: "Agent A",
              projectId: project.id,
              cwd: project.path,
              cliId: "codex",
              launchCommand: "codex",
            },
            {
              id: "agent-b",
              kind: "cli",
              title: "Agent B",
              projectId: project.id,
              cwd: project.path,
              cliId: "claude",
              launchCommand: "claude",
            },
          ],
        },
      },
    });
    useAgentStatusStore.setState({
      byTab: {
        "agent-a": { status: "working", changedAt: 1 },
        "agent-b": { status: "needs-attention", urgency: 1, changedAt: 2 },
      },
    });
  });

  afterEach(cleanup);

  it("shows each live agent status without an aggregate project status", () => {
    renderRepoRow();

    const projectButton = screen.getByRole("button", { name: project.name });
    const agentAButton = screen.getByRole("button", { name: "Agent A" });
    const agentBButton = screen.getByRole("button", { name: "Agent B" });
    const projectRow = projectButton.parentElement;
    const agentARow = agentAButton.parentElement;
    const agentBRow = agentBButton.parentElement;

    expect(projectRow?.querySelector('[aria-label^="tabs.status."]')).toBeNull();
    expect(projectRow).not.toHaveClass("bg-surface-strong");
    expect(agentARow).toHaveClass("bg-surface-strong");
    expect(agentAButton).toHaveAttribute("aria-current", "true");
    expect(agentBRow).not.toHaveClass("bg-surface-strong");
    expect(agentBButton).not.toHaveAttribute("aria-current");
    expect(agentARow?.querySelector('[aria-label="tabs.status.working"]')).not.toBeNull();
    expect(agentBRow?.querySelector('[aria-label="tabs.status.needsAttention"]')).not.toBeNull();
    expect(screen.getAllByLabelText(/^tabs\.status\./)).toHaveLength(2);
  });

  it("moves the active treatment when the open agent changes", () => {
    renderRepoRow();

    act(() => {
      useTabsStore.getState().setActiveTab(project.id, "agent-b");
    });

    const agentAButton = screen.getByRole("button", { name: "Agent A" });
    const agentBButton = screen.getByRole("button", { name: "Agent B" });

    expect(agentAButton.parentElement).not.toHaveClass("bg-surface-strong");
    expect(agentAButton).not.toHaveAttribute("aria-current");
    expect(agentBButton.parentElement).toHaveClass("bg-surface-strong");
    expect(agentBButton).toHaveAttribute("aria-current", "true");
  });
});

describe("RepoRow history rows", () => {
  const historyEntry = {
    id: "r1",
    projectId: project.id,
    cliId: "codex-cli",
    sessionId: "019dd4bf-0929-7ea0-b227-1f51085e7d71",
    cwd: project.path,
    branch: "main",
    capturedAt: "2026-01-01T00:00:00Z",
    lastSeenAt: "2026-01-01T00:00:00Z",
    revision: 1,
  };

  beforeEach(() => {
    useProjectsStore.setState({ projects: [project], activeProjectId: project.id });
    useCodeSidebarStore.setState({ expandedProjects: { [project.id]: true } });
    useResumeStore.setState({ entries: [historyEntry], hydrated: true });
    useTabsStore.setState({
      byProject: { [project.id]: { activeTabId: null, tabs: [] } },
    });
    useAgentStatusStore.setState({ byTab: {} });
  });

  afterEach(cleanup);

  it("labels history as the CLI plus branch, not the branch alone", () => {
    renderRepoRow();
    expect(screen.getByRole("button", { name: "Codex CLI · main" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^main$/ })).toBeNull();
  });

  it("lets the user discard a history row", () => {
    const discard = vi.fn(async () => undefined);
    useResumeStore.setState({ discard });
    renderRepoRow();
    screen.getByLabelText("resume.discardButton").click();
    expect(discard).toHaveBeenCalledWith("r1");
  });
});

