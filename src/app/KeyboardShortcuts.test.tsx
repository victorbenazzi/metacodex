import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const browserPanel = readFileSync(
  new URL("../components/browser/BrowserPanel.tsx", import.meta.url),
  "utf8",
);
const bridge = readFileSync(
  new URL("../../src-tauri/src/commands/browser_init.js", import.meta.url),
  "utf8",
);

describe("browser shortcut authority", () => {
  it("browser content cannot dispatch a global command", () => {
    expect(browserPanel).not.toContain("dispatchBindingFromChild");
    expect(bridge).not.toContain("APP_KEYS");
    expect(bridge).not.toContain('bridge("key"');
    expect(bridge).toContain("e.isTrusted");
  });

  it("keeps the bridge token inside the injected closure", () => {
    expect(bridge).toContain('var bridgeToken = "__MCX_BRIDGE_TOKEN__"');
    expect(bridge).not.toContain("window.bridgeToken");
    expect(bridge).not.toContain("localStorage");
    expect(bridge).not.toContain("dataset");
  });
});
