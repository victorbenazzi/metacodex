import { describe, expect, it, vi } from "vitest";

import type { PtyMetadata } from "./tabMetadata.store";
import { createMetadataPoller } from "./useTabMetadataPolling";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("metadata polling", () => {
  it("never overlaps cycles and schedules after completion", async () => {
    vi.useFakeTimers();
    const first = deferred<PtyMetadata[]>();
    const fetchBatch = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([]);
    const poller = createMetadataPoller({
      intervalMs: 3000,
      getSessionIds: () => Array.from({ length: 12 }, (_, index) => `session-${index}`),
      isPaused: () => false,
      fetchBatch,
      applyBatch: vi.fn(),
      onError: vi.fn(),
    });

    poller.start();
    poller.requestNow();
    poller.requestNow();
    expect(fetchBatch).toHaveBeenCalledTimes(1);
    expect(fetchBatch.mock.calls[0][0]).toHaveLength(12);

    first.resolve([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchBatch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchBatch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchBatch).toHaveBeenCalledTimes(3);
    poller.stop();
    vi.useRealTimers();
  });
});
