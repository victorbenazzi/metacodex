import { describe, expect, it, vi } from "vitest";

import type { BrowserMode, BrowserPick } from "./browser.service";
import type { SendVisualResult } from "./sendToAgent";
import { deliverBrowserVisual } from "./browserDelivery";

function dependencies() {
  return {
    setModeAfterCompositor: vi.fn(async (_mode: BrowserMode): Promise<void> => undefined),
    clearDraw: vi.fn(async (): Promise<void> => undefined),
    capture: vi.fn(async (
      _crop: BrowserPick["rect"] | undefined,
      _expectedMode: BrowserMode,
    ) => ({ path: "/tmp/capture.png" })),
    send: vi.fn(async (_context: string): Promise<SendVisualResult> => ({
      status: "sent",
      sessionId: "session",
      tabId: "tab",
    })),
  };
}

describe("deliverBrowserVisual", () => {
  it("restores pick mode and does not send when the native capture fails", async () => {
    const deps = dependencies();
    deps.capture.mockRejectedValueOnce(new Error("snapshot failed"));

    const result = await deliverBrowserVisual(
      { previousMode: "pick", buildContext: (path) => `screenshot: ${path}` },
      deps,
    );

    expect(result).toEqual({
      status: "failed",
      phase: "capture",
      error: { code: "capture_failed", message: "snapshot failed" },
    });
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.setModeAfterCompositor.mock.calls.map(([mode]) => mode)).toEqual(["browse", "pick"]);
  });

  it("restores the previous mode when the browse compositor ack times out", async () => {
    const deps = dependencies();
    deps.setModeAfterCompositor
      .mockRejectedValueOnce(new Error("browser mode frame timed out"))
      .mockResolvedValueOnce(undefined);

    const result = await deliverBrowserVisual(
      { previousMode: "pick", buildContext: (path) => `screenshot: ${path}` },
      deps,
    );

    expect(result).toEqual({
      status: "failed",
      phase: "mode",
      error: { code: "mode_change_failed", message: "browser mode frame timed out" },
    });
    expect(deps.capture).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.setModeAfterCompositor.mock.calls.map(([mode]) => mode)).toEqual(["browse", "pick"]);
  });

  it("restores capture mode when no CLI is running", async () => {
    const deps = dependencies();
    deps.send.mockResolvedValueOnce({ status: "no-cli" });

    const result = await deliverBrowserVisual(
      {
        previousMode: "capture",
        crop: { x: 10, y: 20, width: 80, height: 60 },
        buildContext: (path) => `screenshot: ${path}`,
      },
      deps,
    );

    expect(result).toEqual({ status: "no-cli" });
    expect(deps.setModeAfterCompositor.mock.calls.map(([mode]) => mode)).toEqual(["browse", "capture"]);
  });

  it("captures draw annotations without clearing them when the PTY write fails", async () => {
    const deps = dependencies();
    deps.send.mockResolvedValueOnce({
      status: "failed",
      error: { code: "Pty", message: "pipe closed" },
    });

    const result = await deliverBrowserVisual(
      { previousMode: "draw", buildContext: (path) => `screenshot: ${path}` },
      deps,
    );

    expect(result).toEqual({
      status: "failed",
      phase: "delivery",
      error: { code: "Pty", message: "pipe closed" },
    });
    expect(deps.setModeAfterCompositor).not.toHaveBeenCalled();
    expect(deps.clearDraw).not.toHaveBeenCalled();
    expect(deps.capture).toHaveBeenCalledWith(undefined, "draw");
  });

  it("clears draw annotations and returns to browse only after delivery succeeds", async () => {
    const order: string[] = [];
    const deps = dependencies();
    deps.capture.mockImplementationOnce(async () => {
      order.push("capture");
      return { path: "/tmp/capture.png" };
    });
    deps.send.mockImplementationOnce(async () => {
      order.push("send");
      return { status: "sent", sessionId: "session", tabId: "tab" };
    });
    deps.clearDraw.mockImplementationOnce(async () => {
      order.push("clear");
    });
    deps.setModeAfterCompositor.mockImplementationOnce(async (mode) => {
      order.push(`mode:${mode}`);
    });

    const result = await deliverBrowserVisual(
      { previousMode: "draw", buildContext: (path) => `screenshot: ${path}` },
      deps,
    );

    expect(result).toMatchObject({ status: "sent", sessionId: "session" });
    expect(order).toEqual(["capture", "send", "mode:browse", "clear"]);
  });

  it("keeps a confirmed delivery successful when post-send cleanup fails", async () => {
    const deps = dependencies();
    deps.clearDraw.mockRejectedValue(new Error("clear failed"));

    const result = await deliverBrowserVisual(
      { previousMode: "draw", buildContext: (path) => `screenshot: ${path}` },
      deps,
    );

    expect(result).toMatchObject({
      status: "sent",
      sessionId: "session",
      cleanupPending: true,
    });
    expect(deps.setModeAfterCompositor.mock.calls.map(([mode]) => mode)).toEqual(["browse"]);
    expect(deps.clearDraw).toHaveBeenCalledTimes(2);
  });

  it("keeps browse mode after capture and PTY delivery both succeed", async () => {
    const deps = dependencies();

    const result = await deliverBrowserVisual(
      { previousMode: "pick", buildContext: (path) => `screenshot: ${path}` },
      deps,
    );

    expect(result).toMatchObject({ status: "sent", sessionId: "session" });
    expect(deps.setModeAfterCompositor.mock.calls.map(([mode]) => mode)).toEqual(["browse"]);
    expect(deps.send).toHaveBeenCalledWith("screenshot: /tmp/capture.png");
  });
});
