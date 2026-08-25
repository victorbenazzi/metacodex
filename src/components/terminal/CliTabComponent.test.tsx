// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ detect: vi.fn() }));

vi.mock("react-i18next", () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/features/terminal/cli-detection", () => ({
  detectCli: mocks.detect,
}));
vi.mock("@/features/terminal/cli-registry", () => ({
  cliById: () => ({
    id: "codex",
    label: "Codex",
    command: "codex",
    launchCommand: "codex",
  }),
  cliLaunchString: () => "codex",
}));
vi.mock("./CliMissingPanel", () => ({
  CliMissingPanel: () => <div data-testid="missing-cli">missing</div>,
}));
vi.mock("./TerminalTab", () => ({ TerminalTab: () => <div>terminal</div> }));
vi.mock("@/features/tabs", () => ({ openTerminal: vi.fn() }));

import { CliTabComponent } from "./CliTabComponent";

const props = {
  tabId: "tab-1",
  cwd: "/project",
  projectId: "project-1",
  cliId: "codex",
  launchCommand: "codex",
  label: "Codex",
};

describe("CliTabComponent detection states", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps a missing CLI distinct from a failed detection", async () => {
    mocks.detect.mockResolvedValueOnce({
      status: "missing",
      installed: false,
      path: null,
      environment: {},
    });
    const missing = render(<CliTabComponent {...props} />);
    expect(await screen.findByTestId("missing-cli")).toBeInTheDocument();
    missing.unmount();

    mocks.detect.mockResolvedValueOnce({
      status: "failed",
      installed: false,
      path: null,
      environment: {},
    });
    render(<CliTabComponent {...props} tabId="tab-2" />);

    expect(await screen.findByText("terminal.detectionFailed")).toBeInTheDocument();
    expect(screen.queryByTestId("missing-cli")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "terminal.retryDetection" }),
    ).toBeInTheDocument();
  });
});
