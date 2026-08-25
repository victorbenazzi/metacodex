import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

import { runFitOnVisible } from "./fitOnVisible";

const frames: FrameRequestCallback[] = [];

function nextFrame(): void {
  const frame = frames.shift();
  if (!frame) throw new Error("Expected a scheduled animation frame");
  frame(0);
}

describe("runFitOnVisible", () => {
  beforeEach(() => {
    frames.length = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fits a stable visible terminal without changing its scroll position", () => {
    const syncScrollArea = vi.fn();
    const scrollToBottom = vi.fn();
    const term = {
      rows: 24,
      refresh: vi.fn(),
      scrollToBottom,
      _core: { viewport: { syncScrollArea } },
    } as unknown as Terminal;
    const fit = { fit: vi.fn() } as unknown as FitAddon;
    const container = { clientWidth: 800, clientHeight: 600 } as HTMLElement;

    runFitOnVisible({ term, fit, getContainer: () => container });
    nextFrame();
    nextFrame();
    nextFrame();

    expect(fit.fit).toHaveBeenCalledOnce();
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
    expect(syncScrollArea).toHaveBeenCalledWith(true);
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("cancels a pending fit", () => {
    const term = {
      rows: 24,
      refresh: vi.fn(),
      _core: { viewport: { syncScrollArea: vi.fn() } },
    } as unknown as Terminal;
    const fit = { fit: vi.fn() } as unknown as FitAddon;
    const container = { clientWidth: 800, clientHeight: 600 } as HTMLElement;

    const cancel = runFitOnVisible({ term, fit, getContainer: () => container });
    cancel();
    nextFrame();

    expect(fit.fit).not.toHaveBeenCalled();
  });
});
