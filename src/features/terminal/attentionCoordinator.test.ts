import { describe, expect, it } from "vitest";

import { nextAttentionTarget } from "./attentionCoordinator";

const cli = (id: string, projectId: string) => ({
  id,
  kind: "cli" as const,
  title: id,
  projectId,
  cwd: `/${projectId}`,
  cliId: "codex-cli",
  launchCommand: "codex",
});

describe("attention coordinator", () => {
  it("combines project tab visibility and chooses the oldest attention", () => {
    const target = nextAttentionTarget(
      {
        newer: { status: "needs-attention", changedAt: 20 },
        older: { status: "needs-attention", changedAt: 10 },
      },
      {
        one: { tabs: [cli("newer", "one")], activeTabId: "newer" },
        two: { tabs: [cli("older", "two")], activeTabId: "older" },
      },
      null,
    );
    expect(target).toEqual({ projectKey: "two", tabId: "older" });
  });

  it("next attention crosses projects after the current item", () => {
    const target = nextAttentionTarget(
      {
        first: { status: "needs-attention", changedAt: 10 },
        second: { status: "needs-attention", changedAt: 20 },
      },
      {
        one: { tabs: [cli("first", "one")], activeTabId: "first" },
        two: { tabs: [cli("second", "two")], activeTabId: "second" },
      },
      "one",
    );
    expect(target).toEqual({ projectKey: "two", tabId: "second" });
  });
});
