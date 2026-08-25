import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("./hooks/useTabActions.ts", import.meta.url), "utf8");

describe("bootstrap command gate", () => {
  it("blocks terminal and agent commands until ready", () => {
    expect(actions).toContain("isAppBootstrapReady()");
    expect(actions).toContain("!activeCwd");
  });

  it("renders retry and never uses root cwd fallback", () => {
    expect(shell).toContain('bootstrap.status !== "ready"');
    expect(shell).toContain("bootstrap.retry");
    expect(shell).not.toContain('homeDirPath ?? "/"');
  });
});
