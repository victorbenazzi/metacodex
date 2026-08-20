import { create } from "zustand";

import { recordDiag } from "@/features/diagnostics/diagnostics.store";

import { resumeApi, type ResumeEntry } from "./resume.service";

interface ResumeState {
  entries: ResumeEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  save: (entry: Omit<ResumeEntry, "id" | "capturedAt" | "lastSeenAt" | "revision">) => Promise<void>;
  discard: (id: string) => Promise<void>;
  recent: (days?: number) => ResumeEntry[];
  forProject: (projectId: string) => ResumeEntry[];
}

const pendingWrites = new Set<Promise<void>>();
const retryWrites = new Map<string, { revision: number; run: () => Promise<void> }>();
const latestWriteRevision = new Map<string, number>();
let latestRevision = 0;

function nextResumeRevision(): number {
  latestRevision = Math.max(Date.now(), latestRevision + 1);
  return latestRevision;
}

function errorDetail(err: unknown, operation: string): Record<string, unknown> {
  return { operation, error: err instanceof Error ? err.message : String(err) };
}

function trackWrite(
  key: string,
  revision: number,
  run: () => Promise<void>,
  retry = false,
): Promise<void> {
  if (!retry) latestWriteRevision.set(key, revision);
  const operation = run();
  pendingWrites.add(operation);
  void operation.then(
    () => {
      if (latestWriteRevision.get(key) === revision) retryWrites.delete(key);
    },
    (err) => {
      if (latestWriteRevision.get(key) === revision) {
        retryWrites.set(key, { revision, run });
      }
      recordDiag("resume.save.fail", { detail: { area: "resume", ...errorDetail(err, key) } });
    },
  ).finally(() => pendingWrites.delete(operation));
  return operation;
}

export async function flushResumeWrites(): Promise<void> {
  await Promise.allSettled(Array.from(pendingWrites));
  const retries = Array.from(retryWrites.entries());
  if (retries.length === 0) return;
  await Promise.all(retries.map(([key, operation]) => (
    trackWrite(key, operation.revision, operation.run, true)
  )));
}

export const useResumeStore = create<ResumeState>((set, get) => ({
  entries: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const entries = await resumeApi.list(null, 30);
      set({ entries, hydrated: true });
    } catch (err) {
      console.warn("[resume] hydrate failed", err);
      set({ hydrated: true });
    }
  },

  refresh: async () => {
    try {
      const entries = await resumeApi.list(null, 30);
      set({ entries });
    } catch (err) {
      console.warn("[resume] refresh failed", err);
    }
  },

  save: async (entry) => {
    const revision = nextResumeRevision();
    const key = `save:${entry.cliId}:${entry.sessionId}:${entry.cwd}`;
    await trackWrite(key, revision, async () => {
      await resumeApi.save({ ...entry, revision });
      await get().refresh();
    });
  },

  discard: async (id) => {
    const revision = nextResumeRevision();
    await trackWrite(`discard:${id}`, revision, async () => {
      await resumeApi.discard(id);
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    });
  },

  recent: (days = 7) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return get().entries.filter((e) => {
      const t = Date.parse(e.lastSeenAt);
      return !Number.isNaN(t) && t >= cutoff;
    });
  },

  forProject: (projectId) => get().entries.filter((e) => e.projectId === projectId),
}));
