import { describe, expect, it } from "vitest";

import { CHANGELOG, compareVersions, latestEntryFor } from "./changelog";

describe("1.0 changelog contract", () => {
  it("announces the milestone with an editorial summary and four pillars", () => {
    expect(CHANGELOG[0]).toMatchObject({
      version: "1.0.0",
      presentation: "milestone",
      titleKey: "whatsNew.r1000.title",
      summaryKey: "whatsNew.r1000.summary",
    });
    expect(CHANGELOG[0]?.highlights).toHaveLength(4);
  });

  it("keeps prereleases below the final release", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(latestEntryFor("1.0.0-rc.1")?.version).toBe("0.0.19");
    expect(latestEntryFor("1.0.0")?.version).toBe("1.0.0");
  });
});
