import { describe, expect, it } from "vitest";

import { CHANGELOG, compareVersions, latestEntryFor } from "./changelog";

describe("1.0 changelog contract", () => {
  it("announces the Linux 1.0.2 patch", () => {
    expect(CHANGELOG[0]).toMatchObject({
      version: "1.0.2",
      titleKey: "whatsNew.r1002.title",
    });
    expect(CHANGELOG[0]?.presentation).toBeUndefined();
    expect(CHANGELOG[0]?.highlights).toHaveLength(3);
  });

  it("announces the 1.0 milestone and adds the 1.0.1 fixes on the same screen", () => {
    expect(CHANGELOG[1]).toMatchObject({
      version: "1.0.1",
      presentation: "milestone",
      titleKey: "whatsNew.r1000.title",
      summaryKey: "whatsNew.r1000.summary",
    });
    expect(CHANGELOG[1]?.highlights).toHaveLength(5);
    expect(CHANGELOG[1]?.highlights.at(-1)).toMatchObject({
      titleKey: "whatsNew.r1001.fixesTitle",
      bodyKey: "whatsNew.r1001.fixesBody",
    });
    expect(CHANGELOG[2]).toMatchObject({
      version: "1.0.0",
      presentation: "milestone",
      titleKey: "whatsNew.r1000.title",
    });
    expect(CHANGELOG[2]?.highlights).toHaveLength(4);
  });

  it("keeps prereleases below the final release", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(latestEntryFor("1.0.0-rc.1")?.version).toBe("0.0.19");
    expect(latestEntryFor("1.0.0")?.version).toBe("1.0.0");
    expect(latestEntryFor("1.0.1")?.version).toBe("1.0.1");
    expect(latestEntryFor("1.0.2")?.version).toBe("1.0.2");
  });
});
