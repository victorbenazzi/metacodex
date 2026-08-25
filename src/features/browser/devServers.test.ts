import { describe, expect, it } from "vitest";

import type { Project } from "@/features/projects/project.types";
import type { TabMetadataEntry } from "@/features/terminal/tabMetadata.store";
import type { TerminalSession } from "@/features/terminal/terminal.types";

import { serversFromSessions } from "./devServers";

const project: Project = {
  id: "p1",
  name: "metacodex",
  path: "/Users/v/metacodex",
  color: "#000000",
  createdAt: "",
  lastOpenedAt: "",
};

function session(partial: Partial<TerminalSession> & Pick<TerminalSession, "id">): TerminalSession {
  return {
    projectId: "p1",
    cwd: "/Users/v/metacodex",
    kind: "cli",
    title: "vite",
    status: "running",
    createdAt: "",
    ...partial,
  };
}

function meta(partial: Partial<TabMetadataEntry> & Pick<TabMetadataEntry, "sessionId">): TabMetadataEntry {
  return {
    pid: 9,
    cwd: "/Users/v/metacodex",
    branch: null,
    listeningPorts: [],
    fetchedAt: 1,
    ...partial,
  };
}

describe("serversFromSessions", () => {
  it("keeps localhost listeners of the active project and skips other projects", () => {
    const sessions = [
      session({ id: "a" }),
      session({ id: "b", projectId: "other", title: "other" }),
    ];
    const metaBySession: Record<string, TabMetadataEntry> = {
      a: meta({
        sessionId: "a",
        listeningPorts: [
          { port: 5173, protocol: "tcp", address: "127.0.0.1", pid: 27 },
          { port: 5173, protocol: "tcp", address: "::1", pid: 27 },
        ],
      }),
      b: meta({
        sessionId: "b",
        listeningPorts: [{ port: 3000, protocol: "tcp", address: "127.0.0.1", pid: 30 }],
      }),
    };
    const servers = serversFromSessions(sessions, metaBySession, [project], "p1");
    expect(servers).toHaveLength(1);
    expect(servers[0]?.port).toBe(5173);
    expect(servers[0]?.projectName).toBe("metacodex");
    expect(servers[0]?.url).toBe("http://localhost:5173");
    expect(servers[0]?.pid).toBe(27);
    expect(servers[0]?.sessionId).toBe("a");
    expect(servers[0]?.id).toBe("a:27:5173");
  });

  it("drops non-loopback addresses", () => {
    const servers = serversFromSessions(
      [session({ id: "a" })],
      {
        a: meta({
          sessionId: "a",
          listeningPorts: [{ port: 8080, protocol: "tcp", address: "192.168.1.9", pid: 40 }],
        }),
      },
      [project],
      "p1",
    );
    expect(servers).toEqual([]);
  });

  it("keeps separate listener processes that share a port", () => {
    const servers = serversFromSessions(
      [session({ id: "a" })],
      {
        a: meta({
          sessionId: "a",
          listeningPorts: [
            { port: 5173, protocol: "tcp", address: "127.0.0.1", pid: 27 },
            { port: 5173, protocol: "tcp", address: "::1", pid: 31 },
          ],
        }),
      },
      [project],
      "p1",
    );

    expect(servers.map((server) => server.pid)).toEqual([27, 31]);
  });
});
