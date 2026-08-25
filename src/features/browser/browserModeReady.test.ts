import { describe, expect, it, vi } from "vitest";

import { setBrowserModeAfterCompositor } from "./browserModeReady";

describe("setBrowserModeAfterCompositor", () => {
  it("waits for the native mode command before settling the bridge callback", async () => {
    const order: string[] = [];
    await setBrowserModeAfterCompositor("browse", {
      setMode: async () => {
        order.push("setMode");
      },
      settleBridge: async () => {
        order.push("settleBridge");
      },
    });

    expect(order).toEqual(["setMode", "settleBridge"]);
  });

  it("does not settle when the native compositor wait fails", async () => {
    const settleBridge = vi.fn(async () => undefined);
    await expect(setBrowserModeAfterCompositor("browse", {
      setMode: async () => {
        throw new Error("browser mode frame timed out");
      },
      settleBridge,
    })).rejects.toThrow("browser mode frame timed out");
    expect(settleBridge).not.toHaveBeenCalled();
  });
});
