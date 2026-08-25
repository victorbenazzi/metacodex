import { describe, expect, it } from "vitest";

import {
  browserExternalTarget,
  isAllowedBrowserUrl,
  isBlankBrowserUrl,
  isBrowserPreviewFile,
  normalizeBrowserUrl,
} from "./url";

describe("browserExternalTarget", () => {
  it("routes web URLs through the system browser command", () => {
    expect(browserExternalTarget("https://example.com/docs")).toEqual({
      command: "openExternalUrl",
      value: "https://example.com/docs",
    });
  });

  it("routes Linux, macOS, Windows, and UNC paths through native path opening", () => {
    for (const path of [
      "/home/victor/project/index.html",
      "C:\\Users\\victor\\project\\index.html",
      "\\\\server\\share\\index.html",
    ]) {
      expect(browserExternalTarget(path), path).toEqual({
        command: "openExternalPath",
        value: path,
      });
    }
    expect(browserExternalTarget("file:///home/victor/project/index.html")).toEqual({
      command: "openExternalPath",
      value: "/home/victor/project/index.html",
    });
    expect(browserExternalTarget("file:///C:/Users/victor/project/index.html")).toEqual({
      command: "openExternalPath",
      value: "C:\\Users\\victor\\project\\index.html",
    });
  });

  it("does not expose internal browser URLs to the operating system", () => {
    expect(
      browserExternalTarget(
        "metacodex-file://0123456789abcdef.localhost/project/index.html",
      ),
    ).toBeNull();
  });
});

describe("normalizeBrowserUrl", () => {
  it("maps a bare port to localhost", () => {
    expect(normalizeBrowserUrl("5173")).toBe("http://localhost:5173");
    expect(normalizeBrowserUrl("1420")).toBe("http://localhost:1420");
  });

  it("keeps an explicit scheme", () => {
    expect(normalizeBrowserUrl("https://example.com/x")).toBe("https://example.com/x");
  });

  it("recognizes authenticated local protocol origins on macOS and Windows", () => {
    expect(
      isAllowedBrowserUrl("metacodex-file://0123456789abcdef.localhost/index.html"),
    ).toBe(true);
    expect(
      isAllowedBrowserUrl("http://metacodex-file.0123456789abcdef.localhost/index.html"),
    ).toBe(true);
  });

  it("prefixes localhost without a scheme", () => {
    expect(normalizeBrowserUrl("localhost:4173")).toBe("http://localhost:4173");
  });

  it("preserves absolute local paths instead of forcing https", () => {
    expect(normalizeBrowserUrl("/Users/victor/project/index.html")).toBe(
      "/Users/victor/project/index.html",
    );
    expect(normalizeBrowserUrl("C:\\Users\\victor\\project\\index.html")).toBe(
      "C:\\Users\\victor\\project\\index.html",
    );
  });

  it("preserves file URLs for authorization by the native boundary", () => {
    expect(normalizeBrowserUrl("file:///Users/victor/project/index.html")).toBe(
      "file:///Users/victor/project/index.html",
    );
  });

  it("does not turn the project preview into a web search surface", () => {
    expect(normalizeBrowserUrl("flexbox")).toBeNull();
    expect(normalizeBrowserUrl("fix flexbox")).toBeNull();
  });

  it("rejects schemes the native webview will not load", () => {
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

describe("local browser previews", () => {
  it("offers the browser for supported web and PDF entry files", () => {
    for (const path of ["index.html", "page.HTM", "app.js", "worker.mjs", "theme.css", "guide.pdf"]) {
      expect(isBrowserPreviewFile(path), path).toBe(true);
    }
  });

  it("does not offer standalone browser navigation for unrelated files", () => {
    for (const path of ["README.md", "component.tsx", "data.json", "image.png", "folder"]) {
      expect(isBrowserPreviewFile(path), path).toBe(false);
    }
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
