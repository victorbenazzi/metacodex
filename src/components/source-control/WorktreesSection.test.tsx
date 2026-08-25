// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "@/features/settings/settings.types";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { useWorktreesStore } from "@/features/git/worktrees.store";
import { DEFAULT_CLI_REGISTRY } from "@/features/terminal/cli-registry";

import { WorktreesSection } from "./WorktreesSection";

const PROJECT_ID = "project-1";
const PROJECT_PATH = "/repo";
const WORKTREE_PATH = "/repo-worktrees/feature-agent-menu";

afterEach(() => {
  cleanup();
  useWorktreesStore.setState({ byProject: {}, occupancyByPath: {} });
  useSettingsDataStore.setState({ settings: DEFAULT_SETTINGS, hydrated: false });
});

describe("WorktreesSection", () => {
  it("lists only enabled agents and launches the selected one in the worktree", async () => {
    const user = userEvent.setup();
    const onLaunchCliInPath = vi.fn();
    const enabledAgents = Object.fromEntries(
      DEFAULT_CLI_REGISTRY.map((cli) => [cli.id, cli.id === "codex-cli"]),
    );

    useSettingsDataStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        interface: {
          ...DEFAULT_SETTINGS.interface,
          enabledAgents,
        },
      },
      hydrated: true,
    });
    useWorktreesStore.setState({
      byProject: {
        [PROJECT_ID]: {
          worktrees: [
            {
              path: WORKTREE_PATH,
              branch: "feature/agent-menu",
              head: "abc123",
              isMain: false,
              locked: false,
              prunable: false,
            },
          ],
          loading: false,
        },
      },
      occupancyByPath: {},
    });

    render(
      <WorktreesSection
        projectId={PROJECT_ID}
        projectPath={PROJECT_PATH}
        onOpenInTerminal={vi.fn()}
        onLaunchCliInPath={onLaunchCliInPath}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More" }));
    const launchAgent = await screen.findByText("Launch agent");
    await user.click(launchAgent);

    expect(await screen.findByText("Codex CLI")).toBeInTheDocument();
    expect(screen.queryByText("Claude Code")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Codex CLI" }));

    expect(onLaunchCliInPath).toHaveBeenCalledTimes(1);
    expect(onLaunchCliInPath).toHaveBeenCalledWith(
      expect.objectContaining({ id: "codex-cli" }),
      WORKTREE_PATH,
      "feature/agent-menu",
    );
  });
});
