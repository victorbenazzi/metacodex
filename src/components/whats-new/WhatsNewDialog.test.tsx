// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("1.0.4"),
}));

vi.mock("@/lib/ipc", () => ({
  CMD: {
    listProjects: "list_projects",
    openExternalUrl: "open_external_url",
    readWhatsNew: "read_whats_new",
    writeWhatsNew: "write_whats_new",
  },
  invoke: invokeMock,
}));

import { CHANGELOG } from "@/features/whats-new/changelog";
import "@/features/i18n/config";
import { useWhatsNewStore } from "@/features/whats-new/whatsNew.store";
import { WhatsNewDialog } from "./WhatsNewDialog";

describe("WhatsNewDialog 1.0.4 presentation", () => {
  beforeEach(() => {
    invokeMock.mockResolvedValue({ lastSeenVersion: "1.0.1" });
    useWhatsNewStore.setState({ open: true, entry: CHANGELOG[0] ?? null });
  });

  afterEach(() => {
    cleanup();
    invokeMock.mockReset();
    useWhatsNewStore.setState({ open: false, entry: null });
  });

  it("renders the macOS accent fix", () => {
    render(<WhatsNewDialog />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-presentation", "standard");
    expect(screen.getByText("Accents restored on macOS")).toBeInTheDocument();
    expect(screen.getByText("Type accents in terminals and coding agents")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
