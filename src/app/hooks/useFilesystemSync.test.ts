import { describe, expect, it, vi } from "vitest";

import type { TerminalSession } from "@/features/terminal/terminal.types";
import { desiredWatcherProjectIds, revalidateActivatedProject } from "./useFilesystemSync";

function session(projectId: string, status: TerminalSession["status"]): TerminalSession {
  return {
    id: `${projectId}-${status}`,
    projectId,
    cwd: `/${projectId}`,
    kind: "shell",
    title: projectId,
    status,
    createdAt: "2026-08-20T00:00:00.000Z",
  };
}

describe("filesystem watcher scope", () => {
  it("watches active project plus projects with running sessions", () => {
    const desired = desiredWatcherProjectIds("active", {
      running: session("background-running", "running"),
      starting: session("background-starting", "starting"),
      idle: session("background-idle", "exited"),
    });

    expect([...desired].sort()).toEqual([
      "active",
      "background-running",
      "background-starting",
    ]);
  });

  it("activation after unwatch performs full revalidation", () => {
    const refreshGit = vi.fn().mockResolvedValue(undefined);
    const refreshWorktrees = vi.fn().mockResolvedValue(undefined);
    const refreshExplorer = vi.fn().mockResolvedValue(undefined);

    revalidateActivatedProject(
      { id: "reactivated", path: "/repo" },
      { refreshGit, refreshWorktrees, refreshExplorer },
    );

    expect(refreshGit).toHaveBeenCalledWith("reactivated", "/repo");
    expect(refreshWorktrees).toHaveBeenCalledWith("reactivated", "/repo");
    expect(refreshExplorer).toHaveBeenCalledWith("reactivated");
  });
});
