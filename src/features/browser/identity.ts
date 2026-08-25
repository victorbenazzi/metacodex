import type { DevServer } from "./devServers";

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
