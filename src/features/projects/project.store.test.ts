import { beforeEach, describe, expect, it, vi } from "vitest";

const remove = vi.hoisted(() => vi.fn());
vi.mock("./project.service", () => ({
  projectsApi: {
    remove,
    list: vi.fn(),
    getActiveId: vi.fn(),
  },
}));

import { useTabsStore } from "@/components/tabs/tabsStore";
import { useProjectsStore } from "./project.store";

describe("project removal transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectsStore.setState({
      projects: [{
        id: "project",
        name: "Project",
        path: "/project",
        color: "#000000",
        createdAt: "now",
        lastOpenedAt: "now",
      }],
      activeProjectId: "project",
      hydrated: true,
      hydrateError: null,
    });
    useTabsStore.setState({
      byProject: {
        project: {
          tabs: [{
            id: "tab",
            kind: "terminal",
            title: "Terminal",
            projectId: "project",
            cwd: "/project",
          }],
          activeTabId: "tab",
        },
      },
    });
  });

  it("backend removal failure preserves frontend resources", async () => {
    remove.mockRejectedValueOnce(new Error("disk full"));
    await expect(useProjectsStore.getState().remove("project")).rejects.toThrow("disk full");
    expect(useProjectsStore.getState().activeProjectId).toBe("project");
    expect(useProjectsStore.getState().projects).toHaveLength(1);
    expect(useTabsStore.getState().byProject.project.tabs).toHaveLength(1);
  });
});
