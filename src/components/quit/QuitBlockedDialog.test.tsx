// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { QuitBlockedDialog } from "./QuitBlockedDialog";

describe("QuitBlockedDialog", () => {
  it("timeout keeps app open and offers retry and force quit", () => {
    const retry = vi.fn();
    const force = vi.fn();
    render(
      <QuitBlockedDialog
        blocked={{
          token: "quit-1",
          failures: [
            {
              area: "workspaces",
              code: "flush_timeout",
              message: "Saving did not finish within five seconds.",
            },
          ],
        }}
        onRetry={retry}
        onForceQuit={force}
      />,
    );

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("quitBlocked.area.workspaces")).toBeVisible();
    expect(screen.getByText("quitBlocked.reason.flushTimeout")).toBeVisible();
    expect(screen.getByText("quitBlocked.warning")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(retry).toHaveBeenCalledWith("quit-1");
    fireEvent.click(screen.getByRole("button", { name: "quitBlocked.forceQuit" }));
    expect(force).toHaveBeenCalledWith("quit-1");
  });
});
