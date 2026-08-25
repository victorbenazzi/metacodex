// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/lib/ipc", () => ({
  CMD: {
    openExternalPath: "open_external_path",
    openExternalUrl: "open_external_url",
  },
  invoke: invokeMock,
  isAppError: () => false,
}));

import { useBrowserUiStore } from "./browser.store";
import { useBrowserNavigation } from "./useBrowserNavigation";

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  useBrowserUiStore.setState({ url: null, address: "" });
});

describe("useBrowserNavigation external opening", () => {
  it("opens the authorized local address instead of the private webview URL", async () => {
    invokeMock.mockResolvedValue(undefined);
    useBrowserUiStore.setState({
      url: "metacodex-file://0123456789abcdef.localhost/project/index.html",
      address: "/home/victor/project/index.html",
    });
    const onFeedback = vi.fn();
    const { result } = renderHook(() =>
      useBrowserNavigation({
        invalidAddress: "invalid",
        navigateFailed: "navigate failed",
        externalOpenFailed: "external failed",
        onFeedback,
      }),
    );

    await act(() => result.current.openExternal());

    expect(invokeMock).toHaveBeenCalledWith("open_external_path", {
      path: "/home/victor/project/index.html",
    });
    expect(onFeedback).not.toHaveBeenCalled();
  });

  it("surfaces native opener failures", async () => {
    invokeMock.mockRejectedValue(new Error("xdg-open failed"));
    useBrowserUiStore.setState({
      url: "https://example.com/",
      address: "https://example.com/",
    });
    const onFeedback = vi.fn();
    const { result } = renderHook(() =>
      useBrowserNavigation({
        invalidAddress: "invalid",
        navigateFailed: "navigate failed",
        externalOpenFailed: "external failed",
        onFeedback,
      }),
    );

    await act(() => result.current.openExternal());

    expect(onFeedback).toHaveBeenCalledWith({
      tone: "error",
      title: "external failed",
      detail: "xdg-open failed",
    });
  });
});
