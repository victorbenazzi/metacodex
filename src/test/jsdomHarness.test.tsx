// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

describe("jsdom test harness", () => {
  it("discovers TSX tests and supports user interaction", async () => {
    const user = userEvent.setup();
    render(<button type="button">Ready</button>);

    await user.click(screen.getByRole("button", { name: "Ready" }));

    expect(screen.getByRole("button", { name: "Ready" })).toBeInTheDocument();
  });
});
