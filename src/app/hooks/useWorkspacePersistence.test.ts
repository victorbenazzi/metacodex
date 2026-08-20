import { describe, expect, it, vi } from "vitest";

import { WorkspaceRevisionQueue } from "./useWorkspacePersistence";

describe("WorkspaceRevisionQueue", () => {
  it("failed save stays dirty and can retry the same revision", async () => {
    const queue = new WorkspaceRevisionQueue();
    queue.hydrate("project", 4);
    expect(queue.markDirty("project")).toBe(5);
    const failed = vi.fn(async () => {
      throw new Error("disk full");
    });
    await expect(queue.save("project", failed)).rejects.toThrow("disk full");
    expect(queue.isDirty("project")).toBe(true);

    const retry = vi.fn(async (revision: number) => ({
      status: "accepted" as const,
      revision,
    }));
    await queue.flush("project", retry);
    expect(retry).toHaveBeenCalledWith(5);
    expect(queue.isDirty("project")).toBe(false);
  });

  it("stale response advances beyond the accepted backend revision", async () => {
    const queue = new WorkspaceRevisionQueue();
    queue.hydrate("project", 1);
    queue.markDirty("project");
    const revisions: number[] = [];
    await queue.flush("project", async (revision) => {
      revisions.push(revision);
      return revisions.length === 1
        ? { status: "stale", acceptedRevision: 8 }
        : { status: "accepted", revision };
    });
    expect(revisions).toEqual([2, 9]);
    expect(queue.isDirty("project")).toBe(false);
  });
});
