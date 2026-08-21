import { WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import type { Project } from "@/features/projects/project.types";
import type { TabMetadataEntry } from "@/features/terminal/tabMetadata.store";
import type { TerminalSession } from "@/features/terminal/terminal.types";

export interface DevServer {
  id: string;
  port: number;
  address: string;
  url: string;
  pid?: number;
  sessionId: string;
  command?: string;
  cwd?: string;
  projectId?: string;
  projectName?: string;
  folderName?: string;
}

function localhostHost(address: string): string | null {
  const host =
    address === "*" ||
    address === "0.0.0.0" ||
    address === "::" ||
    address === "[::]" ||
    address === "[::1]" ||
    address === "::1" ||
    address === "127.0.0.1"
      ? "localhost"
      : address;
  if (host === "localhost" || host.startsWith("127.")) return host;
  return null;
}

function folderName(cwd: string): string | undefined {
  const name = cwd.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return name ? `/${name}` : undefined;
}

/** Dev servers for the start page: listening ports already paid for by PTY metadata. */
export function serversFromSessions(
  sessions: TerminalSession[],
  metaBySession: Record<string, TabMetadataEntry>,
  projects: Project[],
  activeProjectId: string | null,
): DevServer[] {
  const projectKey = activeProjectId ?? WORKSPACE_NULL;
  const seen = new Set<string>();
  const out: DevServer[] = [];
  for (const session of sessions) {
    if (session.status !== "running") continue;
    if ((session.projectId ?? WORKSPACE_NULL) !== projectKey) continue;
    const meta = metaBySession[session.id];
    if (!meta) continue;
    const project = projects.find((item) => item.id === session.projectId);
    for (const port of meta.listeningPorts ?? []) {
      const listenerId = `${port.pid}:${port.port}`;
      if (seen.has(listenerId)) continue;
      const host = localhostHost(port.address);
      if (!host) continue;
      seen.add(listenerId);
      out.push({
        id: `${session.id}:${port.pid}:${port.port}`,
        port: port.port,
        address: host,
        url: `http://localhost:${port.port}`,
        pid: port.pid > 0 ? port.pid : undefined,
        sessionId: session.id,
        command: session.title,
        cwd: meta.cwd || session.cwd,
        projectId: session.projectId ?? undefined,
        projectName: project?.name,
        folderName: folderName(meta.cwd || session.cwd),
      });
    }
  }
  out.sort((a, b) => a.port - b.port);
  return out;
}
