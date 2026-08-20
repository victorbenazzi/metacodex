import { describe, expect, it } from "vitest";

import { collapseUnchanged, diffLines } from "./lineDiff";

describe("diffLines", () => {
  it("marks identical files as equal lines", () => {
    expect(diffLines("a\nb\n", "a\nb\n")).toEqual([
      { type: "eq", text: "a" },
      { type: "eq", text: "b" },
      { type: "eq", text: "" },
    ]);
  });

  it("records an inserted line", () => {
    expect(diffLines("a\nc\n", "a\nb\nc\n")).toEqual([
      { type: "eq", text: "a" },
      { type: "add", text: "b" },
      { type: "eq", text: "c" },
      { type: "eq", text: "" },
    ]);
  });

  it("records a deleted line", () => {
    expect(diffLines("a\nb\nc\n", "a\nc\n")).toEqual([
      { type: "eq", text: "a" },
      { type: "del", text: "b" },
      { type: "eq", text: "c" },
      { type: "eq", text: "" },
    ]);
  });
});

describe("collapseUnchanged", () => {
  it("keeps a short all-equal file", () => {
    const rows = diffLines("a\nb\nc\n", "a\nb\nc\n");
    expect(collapseUnchanged(rows)).toEqual(rows);
  });

  it("drops equal lines far from an edit", () => {
    const head = ["keep", "1", "2", "3", "4", "5", "6", "7", "old", "8", "9"].join("\n");
    const working = ["keep", "1", "2", "3", "4", "5", "6", "7", "new", "8", "9"].join("\n");
    const collapsed = collapseUnchanged(diffLines(head, working), 1);
    expect(collapsed.some((row) => row.text === "keep")).toBe(false);
    expect(collapsed).toEqual(
      expect.arrayContaining([
        { type: "del", text: "old" },
        { type: "add", text: "new" },
      ]),
    );
  });
});
