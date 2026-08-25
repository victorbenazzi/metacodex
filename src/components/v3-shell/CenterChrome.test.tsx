// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
import { useAgentStatusStore } from "@/features/terminal/agent-status.store";
import { CenterChrome } from "./CenterChrome";

describe("CenterChrome agent activity", () => {
  beforeEach(() => {
    useProjectsStore.setState({ activeProjectId: "project-a" });
    useTabsStore.setState({
      byProject: {
        "project-a": {
          activeTabId: "agent-a",
          tabs: [
            {
              id: "agent-a",
              kind: "cli",
              title: "Codex",
              agentTitle: "Thinking",
              projectId: "project-a",
              cwd: "/project-a",
              cliId: "codex",
              launchCommand: "codex",
            },
          ],
        },
      },
    });
    useAgentStatusStore.setState({
      byTab: {
        "agent-a": { status: "working", changedAt: 1 },
      },
    });
  });

  afterEach(cleanup);

  it("uses the same minimal working dot as the sidebar and keeps the title shimmer", async () => {
    const { container } = render(
      <TooltipProvider>
        <CenterChrome />
      </TooltipProvider>,
    );

    await waitFor(() => expect(screen.getByText("Thinking")).toBeVisible());

    expect(screen.getByLabelText("tabs.status.working")).toHaveClass(
      "animate-tab-status-pulse",
    );
    expect(screen.getByText("Thinking")).toHaveClass("loading-shimmer");
    expect(container.querySelector(".loading-pixel")).not.toBeInTheDocument();
  });

  it("clears both working treatments from the shared agent status", async () => {
    const { container } = render(
      <TooltipProvider>
        <CenterChrome />
      </TooltipProvider>,
    );
    await waitFor(() => expect(screen.getByText("Thinking")).toBeVisible());

    useAgentStatusStore.getState().setStatus("agent-a", "idle");

    await waitFor(() => {
      expect(screen.queryByLabelText("tabs.status.working")).not.toBeInTheDocument();
      expect(screen.getByText("Thinking")).not.toHaveClass("loading-shimmer");
    });
    expect(container.querySelector(".loading-pixel")).not.toBeInTheDocument();
  });
});
