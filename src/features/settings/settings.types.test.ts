import { describe, expect, it } from "vitest";

import { mergeSettings } from "./settings.types";

describe("settings accessibility migration", () => {
  it("defaults legacy settings to screen reader mode off", () => {
    expect(mergeSettings({ accessibility: { uiScale: "large" } }).accessibility).toEqual({
      uiScale: "large",
      screenReaderMode: false,
    });
  });

  it("preserves an explicit screen reader preference", () => {
    expect(
      mergeSettings({ accessibility: { screenReaderMode: true } }).accessibility.screenReaderMode,
    ).toBe(true);
  });
});
