// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { DEFAULT_CLI_REGISTRY } from "@/features/terminal/cli-registry";
import { ElevatedLaunchDialog } from "./ElevatedLaunchDialog";

describe("ElevatedLaunchDialog", () => {
  it("requires explicit confirmation for exact elevated flags", () => {
    const confirm = vi.fn();
    render(
      <ElevatedLaunchDialog
        open
        cli={DEFAULT_CLI_REGISTRY.find((entry) => entry.id === "claude-code")!}
        projectName="Project"
        onOpenChange={() => undefined}
        onConfirm={confirm}
      />,
    );
    expect(screen.getByText("--dangerously-skip-permissions")).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "cli.elevatedConfirm" }));
    expect(confirm).toHaveBeenCalledOnce();
  });
});
