// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { BrowserChrome } from "./BrowserChrome";

afterEach(cleanup);

function props() {
  return {
    address: "https://example.com",
    mode: "browse" as const,
    contextDetail: "compact" as const,
    loading: false,
    expanded: false,
    pageLoaded: true,
    capturing: false,
    notice: null,
    onAddressChange: vi.fn(),
    onGo: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    onReload: vi.fn(),
    onMode: vi.fn(),
    onCaptureViewport: vi.fn(),
    onToggleExpand: vi.fn(),
    onContextDetail: vi.fn(),
    onOpenExternal: vi.fn(),
  };
}

describe("BrowserChrome", () => {
  it("submits navigation through the address interface", () => {
    const input = props();
    render(<BrowserChrome {...input} />);

    fireEvent.submit(screen.getByRole("textbox", { name: "browser.addressLabel" }).closest("form")!);

    expect(input.onGo).toHaveBeenCalledWith("https://example.com");
  });

  it("offers direct page actions without a floating menu", () => {
    const input = props();
    render(<BrowserChrome {...input} />);

    fireEvent.click(screen.getByRole("button", { name: "browser.pick" }));
    fireEvent.click(screen.getByRole("button", { name: "browser.captureViewport" }));
    fireEvent.click(screen.getByRole("button", { name: /browser.contextDetail/ }));
    fireEvent.click(screen.getByRole("button", { name: "browser.openExternal" }));

    expect(input.onMode).toHaveBeenCalledWith("pick");
    expect(input.onCaptureViewport).toHaveBeenCalledOnce();
    expect(input.onContextDetail).toHaveBeenCalledWith("diagnostic");
    expect(input.onOpenExternal).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "browser.home" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("explains the current agent context mode on the context button", () => {
    render(<BrowserChrome {...props()} />);

    expect(screen.getByRole("button", { name: /browser.contextDetail/ })).toHaveAttribute(
      "title",
      "browser.contextDetail: browser.contextCompact",
    );
  });

  it("renders delivery feedback in browser chrome", () => {
    render(
      <BrowserChrome
        {...props()}
        notice={{ tone: "error", title: "browser.captureFailed", detail: "snapshot failed" }}
      />,
    );

    expect(
      screen.getByText("browser.captureFailed: snapshot failed"),
    ).toBeVisible();
  });

  it("locks mode and internal navigation while a visual delivery is in flight", () => {
    const input = props();
    render(<BrowserChrome {...input} capturing />);

    expect(screen.getByRole("button", { name: "browser.pick" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "browser.draw" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "browser.captureViewport" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "browser.captureRegion" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "browser.back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "browser.forward" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "browser.reload" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "browser.home" })).not.toBeInTheDocument();
    const address = screen.getByRole("textbox", { name: "browser.addressLabel" });
    expect(address).toBeDisabled();
    fireEvent.submit(address.closest("form")!);
    expect(input.onGo).not.toHaveBeenCalled();
  });
});
