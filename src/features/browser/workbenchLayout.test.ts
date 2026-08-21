import { describe, expect, it } from "vitest";

import { resolveWorkbenchLayout } from "./workbenchLayout";

describe("resolveWorkbenchLayout", () => {
  it("uses the browser overlay only for the visible browser surface without a document", () => {
    expect(resolveWorkbenchLayout({
      view: "browser",
      browserExpanded: true,
      activeDocTabId: null,
    })).toBe("browserOverlay");
  });

  it("uses the regular column when the panel is closed or a document is active", () => {
    expect(resolveWorkbenchLayout({
      view: "closed",
      browserExpanded: true,
      activeDocTabId: null,
    })).toBe("column");
    expect(resolveWorkbenchLayout({
      view: "browser",
      browserExpanded: true,
      activeDocTabId: "doc",
    })).toBe("column");
  });
});
