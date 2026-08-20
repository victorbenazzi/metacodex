import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";

const mocks = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  save: vi.fn(async (_entry: { revision: number }) => undefined),
  discard: vi.fn(async (_id: string) => undefined),
}));

vi.mock("./resume.service", () => ({ resumeApi: mocks }));

import { flushResumeWrites, useResumeStore } from "./resume.store";

describe("resume persistence", () => {
  beforeEach(() => {
    mocks.list.mockClear();
    mocks.save.mockReset();
    mocks.save.mockResolvedValue(undefined);
    mocks.discard.mockReset();
    mocks.discard.mockResolvedValue(undefined);
    useDiagnosticsStore.getState().clear();
    useResumeStore.setState({ entries: [], hydrated: true });
  });

  it("keeps a failed save retryable until the quit flush succeeds", async () => {
    mocks.save.mockRejectedValueOnce(new Error("disk unavailable"));
    const save = useResumeStore.getState().save({
      projectId: "project-1",
      cliId: "claude-code",
      sessionId: "provider-session-1",
      cwd: "/tmp/project-1",
      branch: "main",
    });

    await expect(save).rejects.toThrow("disk unavailable");
    expect(useDiagnosticsStore.getState().entries.at(-1)?.kind).toBe("resume.save.fail");

    await flushResumeWrites();
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[0][0].revision).toBe(mocks.save.mock.calls[1][0].revision);
  });

  it("retries only the newest failed revision for the same identity", async () => {
    const entry = {
      projectId: "project-1",
      cliId: "claude-code",
      sessionId: "provider-session-1",
      cwd: "/tmp/project-1",
      branch: "main",
    };
    mocks.save.mockRejectedValueOnce(new Error("first failure"));
    await expect(useResumeStore.getState().save(entry)).rejects.toThrow("first failure");
    const firstRevision = mocks.save.mock.calls[0][0].revision;

    mocks.save.mockRejectedValueOnce(new Error("second failure"));
    await expect(useResumeStore.getState().save(entry)).rejects.toThrow("second failure");
    const secondRevision = mocks.save.mock.calls[1][0].revision;
    expect(secondRevision).toBeGreaterThan(firstRevision);

    await flushResumeWrites();
    expect(mocks.save).toHaveBeenCalledTimes(3);
    expect(mocks.save.mock.calls[2][0].revision).toBe(secondRevision);
  });
});
