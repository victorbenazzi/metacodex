// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/features/i18n/config";
import { useUsageStore } from "@/features/usage/usage.store";
import { useUsageUiStore } from "@/features/usage/usage.ui.store";
import { useOverlayLockStore } from "@/features/ui/overlayLock.store";
import { initialSnapshot } from "@/features/usage/usage.types";
import { UsageSidebarItem } from "./UsageSidebarItem";
import { UsageDialog } from "./UsageDialog";
import { UsageQuota } from "./UsageQuota";
import { UsageHistory } from "./UsageHistory";
import { UsageAccountConnection } from "./UsageAccountConnection";
import { UsageAccountDetails } from "./UsageAccountDetails";
import type { AccountUsage } from "@/features/usage/usage.types";
import { UsageTurns } from "./UsageTurns";
import { UsageProviderSummary } from "./UsageProviderSummary";
import { KeyboardShortcuts } from "@/app/KeyboardShortcuts";
import { useKeybindingsStore } from "@/features/keybindings/keybindings.store";
import { useTabsStore } from "@/components/tabs/tabsStore";

beforeEach(() => {
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", vendor: "Apple Computer, Inc." });
  useUsageStore.setState({ snapshot: initialSnapshot(), hydrated: true, error: false, refreshing: false });
  vi.spyOn(useUsageStore.getState(), "refresh").mockResolvedValue();
  useUsageUiStore.setState({ open: false, selected: null, returnFocusTo: null });
  useOverlayLockStore.setState({ dialogs: {}, local: false });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Usage interaction", () => {
  it("opens an agent summary on hover, selects its details, and returns focus on Escape", async () => {
    const user = userEvent.setup();
    render(<><UsageSidebarItem /><UsageDialog /></>);
    const trigger = screen.getByRole("button", { name: "Agent usage" });
    await user.hover(trigger);
    const summary = await screen.findByRole("dialog", { name: "Usage overview" });
    expect(Object.keys(useOverlayLockStore.getState().dialogs)).toHaveLength(1);
    await user.click(within(summary).getByRole("button", { name: "Claude Code" }));
    const details = await screen.findByRole("dialog", { name: "Agent usage" });
    expect(details).toHaveAccessibleDescription("Account limits and local activity, with a clear source for every number.");
    expect(within(details).getByText("Claude usage connection")).toBeInTheDocument();
    expect(useUsageUiStore.getState().selected).toBe("claude-code");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Agent usage" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("opens the full overview directly on click", async () => {
    const user = userEvent.setup();
    render(<><UsageSidebarItem /><UsageDialog /></>);
    await user.click(screen.getByRole("button", { name: "Agent usage" }));
    expect(await screen.findByRole("dialog", { name: "Agent usage" })).toBeInTheDocument();
    expect(useUsageUiStore.getState().selected).toBeNull();
  });

  it("closes Usage with the rebindable close command without touching process tabs", async () => {
    const user = userEvent.setup();
    const tabs = useTabsStore.getState().byProject;
    vi.spyOn(useKeybindingsStore.getState(), "resolve").mockReturnValue({ id: "tab.close" });
    render(<><UsageSidebarItem /><UsageDialog /><KeyboardShortcuts /></>);
    await user.click(screen.getByRole("button", { name: "Agent usage" }));
    fireEvent.keyDown(window, { key: "w", metaKey: true });
    await waitFor(() => expect(useUsageUiStore.getState().open).toBe(false));
    expect(useTabsStore.getState().byProject).toBe(tabs);
  });

  it("enables Cursor collection for the selected provider", async () => {
    const user = userEvent.setup();
    const enable = vi.spyOn(useUsageStore.getState(), "setCaptureEnabled").mockResolvedValue();
    useUsageUiStore.setState({ open: true, selected: "cursor-cli" });
    render(<UsageDialog />);
    await user.click(screen.getByRole("button", { name: "Enable for new sessions" }));
    expect(enable).toHaveBeenCalledWith("cursor-cli", true);
    expect(screen.getByText("Cursor observed turns")).toBeInTheDocument();
  });

  it("shows a connected Grok plan without inventing a quota progress bar", () => {
    const provider = { ...initialSnapshot().providers[3], status: "partial" as const, plan: "SuperGrok", billing: { periodStart: 1, periodEnd: 2, usagePeriodStart: 1, usagePeriodEnd: 2 } };
    render(<UsageProviderSummary provider={provider} now={Date.now()} />);
    expect(screen.getByText("SuperGrok")).toBeInTheDocument();
    expect(screen.getByText("The account did not report a quota percentage.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("clears the manual credential input after submission and calls the session connector", async () => {
    const user = userEvent.setup();
    const connect = vi.spyOn(useUsageStore.getState(), "connectCursorCookie").mockResolvedValue();
    render(<UsageAccountConnection providerId="cursor-cli" />);
    await user.click(screen.getByRole("button", { name: "Use browser session" }));
    await user.type(screen.getByLabelText("Cursor session cookie"), "synthetic-session");
    await user.click(screen.getByRole("button", { name: "Connect session" }));
    expect(connect).toHaveBeenCalledWith("synthetic-session");
    expect(screen.queryByLabelText("Cursor session cookie")).not.toBeInTheDocument();
  });

  it("never presents partial account history as a complete cost total", () => {
    const account: AccountUsage = { source: "localFile", includedUsedUsd: 5, includedLimitUsd: 20, onDemandUsedUsd: null, onDemandLimitUsd: null, history: [{ date: "2026-09-16", requests: 1, tokens: "10", apiCostUsd: 8, chargedUsd: 2 }], historyStart: 1, historyEnd: 2, historyIssue: "timeout" };
    render(<UsageAccountDetails account={account} />);
    expect(screen.getByText("The complete history could not be retrieved. Partial totals are hidden. Refresh to try again.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("$5.00")).toBeInTheDocument();
  });

  it("shows missing Cursor counters separately from zero and preserves large values", () => {
    render(<UsageTurns projectName={() => "Fixture"} turns={[{
      sessionId: "session", generationId: "turn", projectId: "fixture", model: "Model",
      inputTokens: "9007199254740993", outputTokens: "0", cacheReadTokens: null, cacheWriteTokens: "25", observedAt: 1,
    }]} />);
    expect(screen.getByRole("cell", { name: "9,007,199,254,740,993" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "0" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Unavailable" })).toBeInTheDocument();
  });

  it("does not present an expired quota as zero usage", () => {
    render(<UsageQuota now={200_000} window={{ id: "five_hour", label: null, usedPercent: 84, durationMinutes: 300, resetsAt: 100 }} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("Awaiting update")).toBeInTheDocument();
  });

  it("keeps token counters above Number.MAX_SAFE_INTEGER exact", () => {
    render(<UsageHistory now={Date.parse("2026-09-16T12:00:00Z")} days={[{ date: "2026-09-15", tokens: "9007199254740993" }, { date: "2026-09-16", tokens: "2" }]} />);
    expect(screen.getByRole("img")).toHaveAccessibleName("9,007,199,254,740,995 reported tokens across 2 reported days");
    fireEvent.click(screen.getByText("View daily values"));
    expect(screen.getByText("9,007,199,254,740,993")).toBeInTheDocument();
  });
});
