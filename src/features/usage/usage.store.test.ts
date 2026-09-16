import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialSnapshot } from "./usage.types";

const api = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn(), setCaptureEnabled: vi.fn(), disconnectAccount: vi.fn() }));
vi.mock("./usage.service", () => ({ usageApi: api }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

describe("usage refresh lifecycle", () => {
  it("shares a pending refresh between the hover card and detail screen", async () => {
    const pending = deferred<ReturnType<typeof initialSnapshot>>();
    api.read.mockResolvedValue(initialSnapshot());
    api.refresh.mockReturnValue(pending.promise);
    const { useUsageStore } = await import("./usage.store");
    const first = useUsageStore.getState().refresh();
    const second = useUsageStore.getState().refresh(true);
    expect(first).toBe(second);
    pending.resolve(initialSnapshot());
    await first;
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(useUsageStore.getState().refreshing).toBe(false);
  });

  it("preserves the last reading when the backend fails", async () => {
    const previous = initialSnapshot();
    previous.providers[0].observedAt = 123;
    api.read.mockResolvedValue(previous);
    api.refresh.mockRejectedValue(new Error("offline"));
    const { useUsageStore } = await import("./usage.store");
    await useUsageStore.getState().refresh();
    expect(useUsageStore.getState().snapshot).toEqual(previous);
    expect(useUsageStore.getState().error).toBe(true);
  });

  it("serializes Claude opt-in after a pending refresh and suppresses polling during configuration", async () => {
    const pending = deferred<ReturnType<typeof initialSnapshot>>();
    const configured = deferred<ReturnType<typeof initialSnapshot>>();
    api.read.mockResolvedValue(initialSnapshot());
    api.refresh.mockReturnValue(pending.promise);
    api.setCaptureEnabled.mockReturnValue(configured.promise);
    const { useUsageStore } = await import("./usage.store");
    const refresh = useUsageStore.getState().refresh();
    const enable = useUsageStore.getState().setCaptureEnabled("claude-code", true);
    expect(api.setCaptureEnabled).not.toHaveBeenCalled();
    pending.resolve(initialSnapshot());
    await refresh;
    await useUsageStore.getState().refresh(true);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(api.setCaptureEnabled).toHaveBeenCalledWith("claude-code", true);
    configured.resolve({ ...initialSnapshot(), claudeEnabled: true });
    await enable;
    expect(useUsageStore.getState().snapshot.claudeEnabled).toBe(true);
  });
  it("disconnects after the pending request so its response cannot restore an old account", async () => {
    const pending = deferred<ReturnType<typeof initialSnapshot>>();
    api.read.mockResolvedValue(initialSnapshot());
    api.refresh.mockReturnValueOnce(pending.promise).mockResolvedValue(initialSnapshot());
    api.disconnectAccount.mockResolvedValue(initialSnapshot());
    const { useUsageStore } = await import("./usage.store");
    const refresh = useUsageStore.getState().refresh();
    const disconnect = useUsageStore.getState().disconnectAccount("cursor-cli");
    expect(api.disconnectAccount).not.toHaveBeenCalled();
    pending.resolve(initialSnapshot());
    await refresh; await disconnect;
    expect(api.disconnectAccount).toHaveBeenCalledWith("cursor-cli");
    expect(useUsageStore.getState().snapshot.providers[2].account).toBeUndefined();
  });

});
