import type { DevServer } from "./browser.service";

export function hostLabel(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function serverTitle(server: DevServer, externalLabel: string): string {
  const project = server.projectName?.trim();
  if (project) return project;
  const folder = server.folderName?.trim();
  if (folder) return folder;
  return externalLabel;
}

export function portOfUrl(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      const port = Number(parsed.port);
      return Number.isInteger(port) ? port : null;
    }
    if (parsed.protocol === "https:") return 443;
    if (parsed.protocol === "http:") return 80;
    return null;
  } catch {
    return null;
  }
}

export function serverForUrl(url: string, servers: DevServer[]): DevServer | undefined {
  const port = portOfUrl(url);
  if (port == null) return undefined;
  return servers.find((server) => server.port === port);
}
