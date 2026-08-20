import { describe, expect, it } from "vitest";

import type { Tab } from "@/components/tabs/types";
import { planClose, planCloseTab, processSummary } from "./closePolicy";

function editor(id: string): Tab {
  return { id, kind: "editor", title: `${id}.ts`, projectId: "p1", path: `/src/${id}.ts` };
}

function terminal(id: string): Tab {
  return { id, kind: "terminal", title: "Terminal", projectId: "p1", cwd: "/src" };
}

function cli(id: string): Tab {
  return {
    id,
    kind: "cli",
    title: "Claude",
    projectId: "p1",
    cwd: "/src",
    cliId: "claude",
    launchCommand: "claude",
  };
}

describe("processSummary", () => {
  it("counts terminals and agents separately", () => {
    expect(processSummary([editor("f"), terminal("t"), cli("c"), cli("c2")])).toEqual({
      terminals: 1,
      agents: 2,
    });
  });
});

describe("planClose", () => {
  it("returns null when there is nothing to close", () => {
    expect(planClose("p1", "single", [])).toBeNull();
  });

  it("closes document tabs without confirm", () => {
    expect(planClose("p1", "all", [editor("a"), editor("b")])).toEqual({
      action: "close",
      ids: ["a", "b"],
      projectKey: "p1",
    });
  });

  it("asks to confirm when a process tab is in the set", () => {
    const term = terminal("t1");
    expect(planClose("p1", "single", [term], term)).toEqual({
      action: "confirm",
      pending: {
        ids: ["t1"],
        mode: "single",
        terminals: 1,
        agents: 0,
        singleTab: term,
        projectKey: "p1",
      },
    });
  });
});

describe("planCloseTab", () => {
  it("returns null for an unknown id", () => {
    expect(planCloseTab("p1", [editor("a")], "missing")).toBeNull();
  });

  it("closes a file tab immediately", () => {
    expect(planCloseTab("p1", [editor("a")], "a")).toEqual({
      action: "close",
      ids: ["a"],
      projectKey: "p1",
    });
  });

  it("confirms a live CLI tab", () => {
    const agent = cli("c1");
    const plan = planCloseTab("p1", [agent], "c1");
    expect(plan?.action).toBe("confirm");
    if (plan?.action === "confirm") {
      expect(plan.pending.agents).toBe(1);
      expect(plan.pending.terminals).toBe(0);
    }
  });
});
