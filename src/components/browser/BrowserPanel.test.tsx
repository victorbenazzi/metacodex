import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./BrowserPanel.tsx", import.meta.url), "utf8");

describe("BrowserPanel visual delivery", () => {
  it("write failure shows error and preserves browser mode", () => {
    expect(source).toContain("await sendVisualToCli");
    expect(source).toContain('result.status === "failed"');
    expect(source).toContain("detail: result.error.message");
  });
});
