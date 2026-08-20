import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentStatusStore } from "./agent-status.store";

describe("agent status store", () => {
  beforeEach(() => {
    useAgentStatusStore.setState({ byTab: {} });
    vi.useRealTimers();
  });

  it("duplicate semantic status preserves object and changedAt", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(10).mockReturnValueOnce(20);
    useAgentStatusStore.getState().setStatus("tab-1", "working", "busy", 1);
    const firstState = useAgentStatusStore.getState();
    const firstEntry = firstState.byTab["tab-1"];

    useAgentStatusStore.getState().setStatus("tab-1", "working", "busy", 1);
    const secondState = useAgentStatusStore.getState();

    expect(secondState).toBe(firstState);
    expect(secondState.byTab).toBe(firstState.byTab);
    expect(secondState.byTab["tab-1"]).toBe(firstEntry);
    expect(secondState.byTab["tab-1"].changedAt).toBe(10);
  });
});
