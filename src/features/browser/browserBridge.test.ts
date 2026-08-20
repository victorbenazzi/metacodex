import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bridge = readFileSync(
  new URL("../../../src-tauri/src/commands/browser_init.js", import.meta.url),
  "utf8",
);
const panel = readFileSync(
  new URL("../../components/browser/BrowserPanel.tsx", import.meta.url),
  "utf8",
);

describe("browser navigation bridge", () => {
  it("history and load publish semantic navigation without polling", () => {
    expect(bridge).toContain('"pushState", "replaceState"');
    expect(bridge).toContain('addEventListener("popstate"');
    expect(bridge).toContain('addEventListener("hashchange"');
    expect(bridge).toContain('addEventListener("DOMContentLoaded"');
    expect(bridge).toContain('addEventListener("load"');
    expect(bridge).toContain('bridge(\n      "location"');
    expect(panel).not.toContain("setInterval");
    expect(panel).not.toContain("currentUrl()");
  });
});
