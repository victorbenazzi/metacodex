// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useTabsStore } from "@/components/tabs/tabsStore";
import { useAgentStatusStore } from "./agent-status.store";
import { useProjectAgentStatus } from "./projectStatus";

describe("project status selector", () => {
  beforeEach(() => {
    useAgentStatusStore.setState({ byTab: {} });
    useTabsStore.setState({
      byProject: {
        projectA: {
          activeTabId: "tab-a",
          tabs: [
            {
              id: "tab-a",
              kind: "terminal",
              title: "A",
              projectId: "projectA",
              cwd: "/a",
            },
          ],
        },
      },
    });
  });

  it("does not rerender for an unrelated project status", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useProjectAgentStatus("projectA");
    });
    const initialRenders = renders;

    act(() => {
      useAgentStatusStore.getState().setStatus("tab-b", "working");
    });

    expect(renders).toBe(initialRenders);
    expect(result.current).toEqual({ status: null, urgency: undefined, sessionCount: 1 });
  });
});
