import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GitInfo } from "./git.types";
import { gitApi } from "./git.service";
import { useGitStore } from "./git.store";

vi.mock("./git.service", () => ({
  gitApi: { status: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function info(branch: string): GitInfo {
  return { branch, ahead: 0, behind: 0, statuses: {}, stagedStatuses: {}, unstagedStatuses: {} };
}

describe("git status refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGitStore.setState({ byProject: {} });
    useGitStore.getState().clearProject("project");
  });

  it("coalesces overlap and ignores stale result", async () => {
    const first = deferred<GitInfo | null>();
    const second = deferred<GitInfo | null>();
    vi.mocked(gitApi.status)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const firstRefresh = useGitStore.getState().refresh("project", "/old");
    const secondRefresh = useGitStore.getState().refresh("project", "/new", true);
    expect(gitApi.status).toHaveBeenCalledTimes(1);

    first.resolve(info("stale"));
    await Promise.resolve();
    await Promise.resolve();
    expect(gitApi.status).toHaveBeenCalledTimes(2);
    expect(useGitStore.getState().get("project")).toBeUndefined();

    second.resolve(info("fresh"));
    await Promise.all([firstRefresh, secondRefresh]);
    expect(useGitStore.getState().get("project")?.branch).toBe("fresh");
  });
});
