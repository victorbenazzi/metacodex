import { describe, expect, it, vi } from "vitest";

import { collectQuitFailures } from "./useQuitCoordinator";

describe("quit coordinator", () => {
  it("flushes every durable owner before acknowledgement", async () => {
    const calls: string[] = [];
    const failures = await collectQuitFailures({
      editors: async () => { calls.push("editors"); },
      settings: async () => { calls.push("settings"); },
      workspaces: async () => { calls.push("workspaces"); },
      resume: async () => { calls.push("resume"); },
      diagnostics: async () => { calls.push("diagnostics"); },
    });

    expect(calls.sort()).toEqual([
      "diagnostics",
      "editors",
      "resume",
      "settings",
      "workspaces",
    ]);
    expect(failures).toEqual([]);
  });

  it("failed flush never acknowledges successful quit", async () => {
    const workspaces = vi.fn(async () => {
      throw { code: "disk_full", message: "No space left" };
    });
    const failures = await collectQuitFailures({
      editors: async () => undefined,
      settings: async () => undefined,
      workspaces,
      resume: async () => undefined,
      diagnostics: async () => undefined,
    });

    expect(workspaces).toHaveBeenCalledOnce();
    expect(failures).toEqual([
      { area: "workspaces", code: "disk_full", message: "No space left" },
    ]);
  });
});
