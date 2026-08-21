import { describe, expect, it } from "vitest";

import { isAllowedBrowserUrl, isBlankBrowserUrl, normalizeBrowserUrl } from "./url";

describe("normalizeBrowserUrl", () => {
  it("maps a bare port to localhost", () => {
    expect(normalizeBrowserUrl("5173")).toBe("http://localhost:5173");
    expect(normalizeBrowserUrl("1420")).toBe("http://localhost:1420");
  });

  it("keeps an explicit scheme", () => {
    expect(normalizeBrowserUrl("https://example.com/x")).toBe("https://example.com/x");
  });

  it("prefixes localhost without a scheme", () => {
    expect(normalizeBrowserUrl("localhost:4173")).toBe("http://localhost:4173");
  });

  it("does not turn the project preview into a web search surface", () => {
    expect(normalizeBrowserUrl("flexbox")).toBeNull();
    expect(normalizeBrowserUrl("fix flexbox")).toBeNull();
  });

  it("rejects schemes the native webview will not load", () => {
    expect(normalizeBrowserUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeBrowserUrl("javascript://alert(1)")).toBeNull();
    expect(normalizeBrowserUrl("data:text/html,hi")).toBeNull();
    expect(normalizeBrowserUrl("https://mcx.invalid/selection")).toBeNull();
  });

  it("allows only the explicit internal blank URL", () => {
    expect(normalizeBrowserUrl("about:blank")).toBe("about:blank");
    expect(normalizeBrowserUrl("about:srcdoc")).toBeNull();
    expect(isAllowedBrowserUrl("about:blank")).toBe(true);
    expect(isAllowedBrowserUrl("about:srcdoc")).toBe(false);
  });
});

describe("isBlankBrowserUrl", () => {
  it("treats only the explicit blank URL as the start page", () => {
    expect(isBlankBrowserUrl(null)).toBe(true);
    expect(isBlankBrowserUrl("about:blank")).toBe(true);
    expect(isBlankBrowserUrl("about:srcdoc")).toBe(false);
    expect(isBlankBrowserUrl("http://localhost:5173")).toBe(false);
  });
});
