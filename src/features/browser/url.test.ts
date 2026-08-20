import { describe, expect, it } from "vitest";

import { isBlankBrowserUrl, normalizeBrowserUrl } from "./url";

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

  it("treats words without a dot as a search", () => {
    expect(normalizeBrowserUrl("flexbox")).toBe(
      "https://www.google.com/search?q=flexbox",
    );
  });
});

describe("isBlankBrowserUrl", () => {
  it("treats about: URLs as the start page", () => {
    expect(isBlankBrowserUrl(null)).toBe(true);
    expect(isBlankBrowserUrl("about:blank")).toBe(true);
    expect(isBlankBrowserUrl("http://localhost:5173")).toBe(false);
  });
});
