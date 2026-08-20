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
const capture = readFileSync(
  new URL("../../../src-tauri/src/commands/browser_capture.rs", import.meta.url),
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

  it("uses a system crosshair for drawing and supports region capture", () => {
    expect(bridge).not.toContain("PEN_CURSOR");
    expect(bridge).toContain('state.mode === "draw" ? "crosshair"');
    expect(bridge).toContain('bridge("capture")');
    expect(bridge).toContain("takeCaptureRegion");
  });

  it("requires a trusted pointer gesture before selecting a capture region", () => {
    expect(bridge).toMatch(/function onDown\(e\)[\s\S]*?state\.mode === "capture"[\s\S]*?if \(!e\.isTrusted\) return;/);
    expect(bridge).toMatch(/function onUp\(e\)[\s\S]*?state\.mode === "capture"[\s\S]*?if \(!e\.isTrusted\) return;/);
  });

  it("selects through open shadow roots and lets the user move across ancestors", () => {
    expect(bridge).toContain("function deepElementFromPoint");
    expect(bridge).toContain("shadowRoot.elementFromPoint");
    expect(bridge).toContain("function targetAtDepth");
    expect(bridge).toContain('e.code === "BracketLeft"');
    expect(bridge).toContain('e.code === "BracketRight"');
  });

  it("classifies semantic text separately from structural elements", () => {
    expect(bridge).toContain('kind: isTextTarget(tag) ? "text" : "element"');
    expect(bridge).toContain("selectedTextForTarget");
    expect(bridge).toContain("fullElementPath");
    expect(bridge).toContain("accessibilityInfo");
    expect(bridge).toContain("diagnosticStyles");
  });

  it("omits oversized identifiers instead of presenting truncated selectors", () => {
    expect(bridge).toContain('if (text.length > max) return "";');
  });

  it("takes snapshots without forcing a webview repaint", () => {
    expect(capture).toContain("config.setAfterScreenUpdates(false)");
    expect(capture).not.toContain("config.setAfterScreenUpdates(true)");
  });
});
