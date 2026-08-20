import { useEffect } from "react";

import { CMD, invoke } from "@/lib/ipc";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import {
  useTabMetadataStore,
  type PtyMetadata,
} from "@/features/terminal/tabMetadata.store";

interface MetadataPollerOptions {
  intervalMs: number;
  getSessionIds: () => string[];
  isPaused: () => boolean;
  fetchBatch: (sessionIds: string[]) => Promise<PtyMetadata[]>;
  applyBatch: (batch: PtyMetadata[]) => void;
  onError: (error: unknown) => void;
}

export interface MetadataPoller {
  start: () => void;
  requestNow: () => void;
  stop: () => void;
}

export function createMetadataPoller(options: MetadataPollerOptions): MetadataPoller {
  let stopped = false;
  let running = false;
  let rerunRequested = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clearTimer();
    if (!stopped) timer = setTimeout(run, options.intervalMs);
  };

  const run = async () => {
    clearTimer();
    if (stopped) return;
    if (running) {
      rerunRequested = true;
      return;
    }
    if (options.isPaused()) {
      schedule();
      return;
    }
    const ids = options.getSessionIds();
    if (ids.length === 0) {
      schedule();
      return;
    }
    running = true;
    try {
      options.applyBatch(await options.fetchBatch(ids));
    } catch (error) {
      options.onError(error);
    } finally {
      running = false;
      if (stopped) return;
      if (rerunRequested) {
        rerunRequested = false;
        void run();
      } else {
        schedule();
      }
    }
  };

  return {
    start() {
      stopped = false;
      void run();
    },
    requestNow() {
      clearTimer();
      void run();
    },
    stop() {
      stopped = true;
      rerunRequested = false;
      clearTimer();
    },
  };
}

export function useTabMetadataPolling(intervalMs = 3000) {
  useEffect(() => {
    const poller = createMetadataPoller({
      intervalMs,
      getSessionIds: () =>
        Object.values(useTerminalStore.getState().sessions)
          .filter((session) => session.status === "running")
          .map((session) => session.id)
          .sort(),
      isPaused: () => document.hidden,
      fetchBatch: (sessionIds) =>
        invoke<PtyMetadata[]>(CMD.ptyMetadataBatch, { sessionIds }),
      applyBatch: (batch) => useTabMetadataStore.getState().setBatch(batch),
      onError: (error) => console.warn("[pty_metadata_batch] failed", error),
    });
    const onVisible = () => {
      if (!document.hidden) poller.requestNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    poller.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      poller.stop();
    };
  }, [intervalMs]);
}
