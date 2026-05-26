import { CMD, invoke } from "@/lib/ipc";

export interface ResumeEntry {
  id: string;
  projectId: string | null;
  cliId: string;
  sessionId: string;
  cwd: string;
  branch: string | null;
  capturedAt: string;
  lastSeenAt: string;
}

export const resumeApi = {
  list(projectId?: string | null, days?: number): Promise<ResumeEntry[]> {
    return invoke<ResumeEntry[]>(CMD.resumeList, {
      projectId: projectId ?? null,
      days: days ?? null,
    });
  },
  save(entry: Omit<ResumeEntry, "id" | "capturedAt" | "lastSeenAt"> & {
    id?: string;
    capturedAt?: string;
    lastSeenAt?: string;
  }): Promise<void> {
    return invoke<void>(CMD.resumeSave, {
      entry: {
        id: entry.id ?? "",
        projectId: entry.projectId,
        cliId: entry.cliId,
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        branch: entry.branch,
        capturedAt: entry.capturedAt ?? "",
        lastSeenAt: entry.lastSeenAt ?? "",
      },
    });
  },
  discard(id: string): Promise<void> {
    return invoke<void>(CMD.resumeDiscard, { id });
  },
};
