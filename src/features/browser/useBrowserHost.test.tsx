// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "@/features/settings/settings.store";
import { DialogRoot } from "@/components/ui/Dialog";

const browserMocks = vi.hoisted(() => ({
  hide: vi.fn(() => Promise.resolve()),
  setBounds: vi.fn(() => Promise.resolve()),
}));

vi.mock("./browser.service", () => ({
  browserApi: browserMocks,
}));

import { useBrowserHost } from "./useBrowserHost";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

function BrowserHostHarness() {
  const ref = useBrowserHost({
    active: true,
    pageLoaded: true,
    mode: "browse",
    expanded: false,
  });
  return <div ref={ref} />;
}

describe("useBrowserHost", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    browserMocks.hide.mockClear();
    browserMocks.setBounds.mockClear();
    useSettingsStore.setState({ open: false });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      top: 20,
      right: 810,
      bottom: 620,
      left: 10,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useSettingsStore.setState({ open: false });
    vi.unstubAllGlobals();
  });

  it("hides the native webview when a modal opens before pending bounds sync", async () => {
    render(<BrowserHostHarness />);

    act(() => useSettingsStore.getState().setOpen(true));
    await act(async () => {
      for (const frame of frames.values()) frame(0);
      frames.clear();
    });

    expect(browserMocks.hide).toHaveBeenCalled();
    expect(browserMocks.setBounds).not.toHaveBeenCalled();
  });

  it("hides the native webview behind a shared local dialog", async () => {
    const view = render(
      <>
        <BrowserHostHarness />
        <DialogRoot open onOpenChange={() => undefined} />
      </>,
    );

    await act(async () => {
      for (const frame of frames.values()) frame(0);
      frames.clear();
    });

    expect(browserMocks.hide).toHaveBeenCalled();
    expect(browserMocks.setBounds).not.toHaveBeenCalled();

    view.rerender(
      <>
        <BrowserHostHarness />
        <DialogRoot open={false} onOpenChange={() => undefined} />
      </>,
    );
    await act(async () => {
      for (const frame of frames.values()) frame(0);
      frames.clear();
    });

    expect(browserMocks.setBounds).toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
  });
});
