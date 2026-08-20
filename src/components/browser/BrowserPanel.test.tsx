import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./BrowserPanel.tsx", import.meta.url), "utf8");
const overlayLock = readFileSync(
  new URL("../../features/ui/overlayLock.store.ts", import.meta.url),
  "utf8",
);

describe("BrowserPanel visual delivery", () => {
  it("write failure shows error and preserves browser mode", () => {
    expect(source).toContain("await sendVisualToCli");
    expect(source).toContain('result.status === "failed"');
    expect(source).toContain("detail: result.error.message");
  });

  it("offers viewport and region screenshot choices without recents", () => {
    expect(source).toContain('t("browser.captureViewport")');
    expect(source).toContain('t("browser.captureRegion")');
    expect(source).not.toContain("recents");
    expect(source).not.toContain("clearHistory");
  });

  it("offers compact and diagnostic context while keeping compact as the default", () => {
    expect(source).toContain('contextDetail = useBrowserUiStore');
    expect(source).toContain('setContextDetail("compact")');
    expect(source).toContain('setContextDetail("diagnostic")');
    expect(source).toContain("formatPickContext(pick, screenshotPath, contextDetail)");
  });

  it("identifies selected screenshot areas as regions", () => {
    expect(source).toContain('crop ? "target: region" : "target: viewport"');
    expect(source).toContain('`rect: ${Math.round(crop.x)},${Math.round(crop.y)}');
  });

  it("leaves capture mode and reports an error when the selected region cannot be read", () => {
    expect(source).toContain('setMode("browse")');
    expect(source).toContain('throw new Error(t("browser.captureRegionMissing"))');
    expect(source).toContain('title: t("browser.captureFailed")');
  });

  it("does not hide the native webview while browser feedback toasts are visible", () => {
    expect(overlayLock).not.toContain("useToastStore");
    expect(overlayLock).not.toContain("toastOpen");
  });
});
