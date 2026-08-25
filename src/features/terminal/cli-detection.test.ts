import { beforeEach, describe, expect, it, vi } from "vitest";

const detect = vi.hoisted(() => vi.fn());
vi.mock("./cli.service", () => ({ cliApi: { detect } }));

import { DEFAULT_CLI_REGISTRY } from "./cli-registry";
import { detectCli, resetCliDetectionsForTests } from "./cli-detection";

describe("CLI detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCliDetectionsForTests();
  });

  it("shares one request and distinguishes failure from missing", async () => {
    let reject: ((error: Error) => void) | undefined;
    detect.mockReturnValueOnce(new Promise((_resolve, nextReject) => { reject = nextReject; }));
    const cli = DEFAULT_CLI_REGISTRY[0];
    const first = detectCli(cli);
    const second = detectCli(cli);
    expect(detect).toHaveBeenCalledOnce();
    reject?.(new Error("timed out"));
    await expect(first).resolves.toMatchObject({ status: "failed" });
    await expect(second).resolves.toMatchObject({ status: "failed" });

    resetCliDetectionsForTests();
    detect.mockResolvedValueOnce({ installed: false, path: null, environment: {} });
    await expect(detectCli(cli)).resolves.toMatchObject({ status: "missing" });
  });
});
