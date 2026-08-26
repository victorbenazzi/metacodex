import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import i18n from "@/features/i18n/config";
import { useAgentStatusStore } from "@/features/terminal/agent-status.store";
import { createAgentHeuristic } from "@/features/terminal/agentHeuristic";
import { dispatchAgentNotification } from "@/features/terminal/notificationDispatch";
import { installOscHandlers } from "@/features/terminal/oscHandlers";
import { subscribePtyData, subscribePtyExit } from "@/features/terminal/ptyEvents";
import { ptyEventMultiplexer } from "@/features/terminal/ptyEventMultiplexer";
import { ptyApi } from "@/features/terminal/terminal.service";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import type {
  PtySpawnSpec,
  TerminalFailureStep,
  TerminalRuntimeState,
  TerminalStartStep,
} from "@/features/terminal/terminal.types";
import { useTabsStore, WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { recordDiag } from "@/features/diagnostics/diagnostics.store";
import { base64ToUint8Array, utf8ToBase64 } from "@/lib/base64";
import type { PtyExitReason } from "@/lib/events";
import { CMD, invoke } from "@/lib/ipc";
import { applyTerminalFit } from "./fitOnVisible";

const AGENT_TITLE_MAX = 40;

/**
 * Clean up a raw OSC 0/1/2 payload before storing it as the tab's agentTitle.
 */
export function sanitizeAgentTitle(raw: string, defaultTitle: string): string | null {
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
  s = s.replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff\u00ad\u202f]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > AGENT_TITLE_MAX) s = s.slice(0, AGENT_TITLE_MAX - 1) + "…";
  if (s === defaultTitle) return null;
  return s;
}

export type PtyIo = {
  prepare: typeof ptyApi.prepare;
  start: typeof ptyApi.start;
  kill: typeof ptyApi.kill;
  write: typeof ptyApi.write;
  resize: typeof ptyApi.resize;
};

export type SessionControllerDeps = {
  pty: PtyIo;
  subscribeData: typeof subscribePtyData;
  subscribeExit: typeof subscribePtyExit;
  ensureListeners?: () => Promise<void>;
  attachEvents: (sessionId: string, afterSeq?: number) => Promise<number>;
  clock?: Partial<SessionControllerClock>;
  diagnostics?: (
    phase: string,
    error: unknown,
    context?: { tabId: string; sessionId?: string | null },
  ) => void;
};

export type SessionControllerClock = {
  nextFrame: () => Promise<void>;
  now: () => number;
  setInterval: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

const defaultClock: SessionControllerClock = {
  nextFrame: () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  now: () => Date.now(),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (timer) => clearInterval(timer),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

export type StartArgs = {
  tabId: string;
  projectId: string | null;
  cwd: string;
  label: string;
  cliLaunchCommand?: string;
  cliLaunch?: {
    executable: string;
    args: string[];
    environment: Record<string, string>;
  };
  cliToolId?: string;
  prefillCommand?: string;
  term: Terminal;
  fit: FitAddon;
  getContainer: () => HTMLElement | null;
  disposed: () => boolean;
  onSession?: (sessionId: string | null) => void;
  onExit?: (info: { code: number; reason: PtyExitReason }) => void;
};

type LiveEntry = {
  sessionId: string | null;
  revision: number;
  desired: "running" | "stopped";
  phase: "idle" | "starting" | "running" | "stopping" | "exited" | "failed";
  runtimeState: TerminalRuntimeState | null;
  cleanups: Array<() => void>;
  /** Last operation; every later intent waits for its effects to settle. */
  chain: Promise<void>;
};

export type SessionController = {
  start(args: StartArgs): Promise<void>;
  /** Idempotent. Safe from unmount and Tab lifecycle. Cancels in-flight start. */
  stop(tabId: string): Promise<void>;
  getSessionId(tabId: string): string | null;
  getState(tabId: string): TerminalRuntimeState | null;
  subscribe(tabId: string, listener: (state: TerminalRuntimeState) => void): () => void;
};

function createEntry(): LiveEntry {
  return {
    sessionId: null,
    revision: 0,
    desired: "stopped",
    phase: "idle",
    runtimeState: null,
    cleanups: [],
    chain: Promise.resolve(),
  };
}

/**
 * Session controller: owns PTY Session lifecycle for Process tabs.
 * Fit-on-visible stays in TerminalTab (DOM policy, independent of this map).
 */
export function createSessionController(deps: SessionControllerDeps): SessionController {
  const byTab = new Map<string, LiveEntry>();
  const listenersByTab = new Map<string, Set<(state: TerminalRuntimeState) => void>>();
  const clock: SessionControllerClock = { ...defaultClock, ...deps.clock };

  const publish = (tabId: string, entry: LiveEntry, state: TerminalRuntimeState) => {
    entry.runtimeState = state;
    for (const listener of listenersByTab.get(tabId) ?? []) listener(state);
  };

  const normalizeError = (error: unknown): { code: string; message: string } => {
    if (error instanceof Error) {
      return { code: error.name || "Error", message: error.message };
    }
    if (typeof error === "object" && error !== null) {
      const value = error as { code?: unknown; message?: unknown };
      return {
        code: typeof value.code === "string" ? value.code : "Unknown",
        message:
          typeof value.message === "string" ? value.message : JSON.stringify(error),
      };
    }
    return { code: "Unknown", message: String(error) };
  };

  const isGone = (error: unknown): boolean => normalizeError(error).code === "NotFound";

  const publishFailure = (
    tabId: string,
    entry: LiveEntry,
    step: TerminalFailureStep,
    error: unknown,
  ) => {
    const normalized = normalizeError(error);
    entry.phase = "failed";
    publish(tabId, entry, {
      phase: "failed",
      step,
      error: normalized,
      retryable: true,
    });
    deps.diagnostics?.(step, normalized, { tabId, sessionId: entry.sessionId });
  };

  const runCleanups = (entry: LiveEntry) => {
    const list = entry.cleanups.splice(0, entry.cleanups.length);
    for (const fn of list) {
      try {
        fn();
      } catch (err) {
        deps.diagnostics?.("cleanup", normalizeError(err));
        console.warn("[sessionController] cleanup failed", err);
      }
    }
  };

  const disposeSession = async (tabId: string, entry: LiveEntry): Promise<void> => {
    const sessionId = entry.sessionId;
    entry.sessionId = null;
    runCleanups(entry);
    useAgentStatusStore.getState().clear(tabId);
    if (sessionId) {
      await deps.pty.kill(sessionId).catch((error) => {
        deps.diagnostics?.("kill", normalizeError(error), { tabId, sessionId });
      });
      useTerminalStore.getState().remove(sessionId);
    }
  };

  const isCurrent = (
    entry: LiveEntry,
    revision: number,
    desired: LiveEntry["desired"],
  ) => entry.revision === revision && entry.desired === desired;

  const stop = (tabId: string): Promise<void> => {
    const entry = byTab.get(tabId);
    if (!entry) return Promise.resolve();

    const revision = ++entry.revision;
    entry.desired = "stopped";
    entry.phase = "stopping";
    const prior = entry.chain;

    const done = (async () => {
      await prior.catch(() => undefined);
      if (!isCurrent(entry, revision, "stopped")) return;
      await disposeSession(tabId, entry);
      if (!isCurrent(entry, revision, "stopped")) return;
      entry.phase = "idle";
      if (byTab.get(tabId) === entry) {
        byTab.delete(tabId);
      }
    })();

    entry.chain = done.catch(() => undefined);
    return done;
  };

  const start = (args: StartArgs): Promise<void> => {
    let entry = byTab.get(args.tabId);
    if (!entry) {
      entry = createEntry();
      byTab.set(args.tabId, entry);
    }

    const revision = ++entry.revision;
    entry.desired = "running";
    entry.phase = "starting";
    publish(args.tabId, entry, { phase: "starting", step: "listeners" });
    const prior = entry.chain;
    const run = (async () => {
      await prior.catch(() => undefined);
      if (!isCurrent(entry, revision, "running")) return;

      try {
        await deps.ensureListeners?.();
      } catch (error) {
        if (isCurrent(entry, revision, "running")) {
          publishFailure(args.tabId, entry, "listeners", error);
        }
        return;
      }
      if (!isCurrent(entry, revision, "running")) return;

      // Tear down any leftover session from a previous life on this entry.
      if (entry.sessionId !== null || entry.cleanups.length > 0) {
        await disposeSession(args.tabId, entry);
      }
      if (!isCurrent(entry, revision, "running")) return;

      args.onSession?.(null);

      const projectKey = args.projectId ?? WORKSPACE_NULL;
      const term = args.term;
      const fit = args.fit;
      let lastCwdPushed: string | null = null;
      let lastAgentTitlePushed: string | null = null;

      const oscDisposables = installOscHandlers(term, {
        fallbackTitles: {
          agentFinished: i18n.t("notifications.agentDone"),
          agentMessage: i18n.t("notifications.agentMessage"),
        },
        onCwd: (path) => {
          if (path === lastCwdPushed) return;
          lastCwdPushed = path;
          const sid = entry.sessionId;
          if (!sid) return;
          invoke(CMD.ptyUpdateCwd, { sessionId: sid, cwd: path }).catch((err) => {
            console.warn("[pty_update_cwd] failed", err);
          });
        },
        onTitle: (raw) => {
          const cleaned = sanitizeAgentTitle(raw, args.label);
          if (cleaned === lastAgentTitlePushed) return;
          lastAgentTitlePushed = cleaned;
          useTabsStore.getState().setTabTitles(projectKey, args.tabId, {
            agentTitle: cleaned ?? null,
          });
        },
        onNotify: (payload) => {
          useAgentStatusStore.getState().setStatus(
            args.tabId,
            payload.isDone ? "done" : "needs-attention",
            payload.body ?? payload.title,
            payload.urgency,
          );
          dispatchAgentNotification({
            tabId: args.tabId,
            title: payload.title,
            body: payload.body,
            sound: payload.sound,
          });
        },
      });
      entry.cleanups.push(() => {
        for (const d of oscDisposables) d.dispose();
      });

      const heuristic = createAgentHeuristic(term, {
        cliId: args.cliToolId,
        getStatus: () => useAgentStatusStore.getState().byTab[args.tabId]?.status,
        setStatus: (status, hint) => {
          useAgentStatusStore.getState().setStatus(args.tabId, status, hint);
        },
      });
      entry.cleanups.push(() => heuristic.dispose());

      const doneSweeper = clock.setInterval(() => {
        const e = useAgentStatusStore.getState().byTab[args.tabId];
        if (e && e.status === "done" && clock.now() - e.changedAt > 4000) {
          useAgentStatusStore.getState().clear(args.tabId);
        }
      }, 1000);
      entry.cleanups.push(() => clock.clearInterval(doneSweeper));

      // Two rAFs so xterm can init its renderer before PTY data arrives.
      await clock.nextFrame();
      await clock.nextFrame();
      if (!isCurrent(entry, revision, "running")) return;

      try {
        if (args.getContainer()?.clientWidth) {
          applyTerminalFit(term, fit);
        }
      } catch {
        // ResizeObserver / fit-on-visible will retry
      }
      if (!isCurrent(entry, revision, "running")) return;

      const localKind = args.cliLaunchCommand ? "cli" : "shell";
      let failurePhase: TerminalStartStep = "prepare";
      publish(args.tabId, entry, { phase: "starting", step: "prepare" });

      try {
        const rows = term.rows || 24;
        const cols = term.cols || 80;
        const spec: Omit<PtySpawnSpec, "theme_kind"> = {
          project_id: args.projectId,
          cwd: args.cwd,
          rows,
          cols,
          kind: args.cliLaunch
            ? { kind: "cli", ...args.cliLaunch }
            : args.cliLaunchCommand
              ? { kind: "cli", executable: args.cliLaunchCommand, args: [], environment: {} }
            : { kind: "plain" },
          label: args.label,
          cli_id: args.cliToolId,
        };
        const { sessionId } = await deps.pty.prepare(spec);

        if (!isCurrent(entry, revision, "running")) {
          await deps.pty.kill(sessionId).catch(() => undefined);
          return;
        }

        entry.sessionId = sessionId;
        args.onSession?.(sessionId);

        useTerminalStore.getState().register({
          id: sessionId,
          tabId: args.tabId,
          projectId: args.projectId,
          cwd: args.cwd,
          kind: localKind,
          cliToolId: args.cliToolId,
          title: args.label,
          status: "starting",
          createdAt: new Date().toISOString(),
        });

        let exitedBeforeStartReturn = false;
        let prefillWritten = false;
        let prefillTimer: ReturnType<typeof setTimeout> | null = null;
        entry.cleanups.push(() => {
          if (prefillTimer != null) clock.clearTimeout(prefillTimer);
        });

        const unlistenData = deps.subscribeData(sessionId, (payload) => {
          if (args.disposed()) return;
          const bytes = base64ToUint8Array(payload.data_b64);
          try {
            term.write(bytes);
          } catch (writeErr) {
            console.warn("[pty] term.write failed", writeErr);
          }
          if (!prefillWritten && args.prefillCommand) {
            prefillWritten = true;
            const cmd = args.prefillCommand;
            prefillTimer = clock.setTimeout(() => {
              prefillTimer = null;
              if (!isCurrent(entry, revision, "running")) return;
              deps.pty.write(sessionId, utf8ToBase64(cmd)).catch((error) => {
                deps.diagnostics?.("write", normalizeError(error), {
                  tabId: args.tabId,
                  sessionId,
                });
              });
            }, 200);
          }
        });
        entry.cleanups.push(unlistenData);

        const unlistenExit = deps.subscribeExit(sessionId, (payload) => {
          exitedBeforeStartReturn = true;
          const reason = payload.reason as PtyExitReason;
          if (entry.sessionId === sessionId) {
            entry.phase = "exited";
            publish(args.tabId, entry, {
              phase: "exited",
              code: payload.exit_code,
              reason,
            });
          }
          if (!args.disposed()) {
            term.writeln(`\r\n\x1b[2m${i18n.t("terminal.processExited")}\x1b[0m`);
          }
          useTerminalStore.getState().setStatus(sessionId, "exited", payload.exit_code);
          if (reason !== "normal" || payload.exit_code !== 0) {
            args.onExit?.({ code: payload.exit_code, reason });
          }
          if (args.cliToolId != null) {
            useAgentStatusStore.getState().setStatus(args.tabId, "done");
            dispatchAgentNotification({
              tabId: args.tabId,
              title: i18n.t("notifications.agentDone"),
              body: args.label,
              sound: true,
            });
          }
          useTabsStore.getState().setTabTitles(projectKey, args.tabId, {
            agentTitle: null,
          });
        });
        entry.cleanups.push(unlistenExit);

        const dataDisposable = term.onData((d) => {
          const sid = entry.sessionId;
          if (!sid) return;
          deps.pty.write(sid, utf8ToBase64(d)).catch((error) => {
            deps.diagnostics?.("write", normalizeError(error), {
              tabId: args.tabId,
              sessionId: sid,
            });
          });
        });
        const resizeDisposable = term.onResize(({ rows: r, cols: c }) => {
          const sid = entry.sessionId;
          if (!sid) return;
          if (entry.phase === "exited" || entry.phase === "stopping" || entry.phase === "failed") {
            return;
          }
          deps.pty.resize(sid, r, c).catch((error) => {
            if (isGone(error)) return;
            deps.diagnostics?.("resize", normalizeError(error), {
              tabId: args.tabId,
              sessionId: sid,
            });
          });
        });
        entry.cleanups.push(() => {
          dataDisposable.dispose();
          resizeDisposable.dispose();
        });

        failurePhase = "attach";
        publish(args.tabId, entry, { phase: "starting", step: "attach" });
        await deps.attachEvents(sessionId, 0);
        if (!isCurrent(entry, revision, "running")) {
          await disposeSession(args.tabId, entry);
          return;
        }

        failurePhase = "child";
        publish(args.tabId, entry, { phase: "starting", step: "child" });
        await deps.pty.start(sessionId);
        if (!isCurrent(entry, revision, "running")) {
          await disposeSession(args.tabId, entry);
          return;
        }

        if (!exitedBeforeStartReturn) {
          entry.phase = "running";
          publish(args.tabId, entry, { phase: "running", sessionId });
          useTerminalStore.getState().setStatus(sessionId, "running");
        }

        try {
          if (!exitedBeforeStartReturn && entry.phase !== "exited") {
            await deps.pty.resize(sessionId, term.rows, term.cols);
          }
        } catch (error) {
          if (!isGone(error)) {
            deps.diagnostics?.("resize", normalizeError(error), {
              tabId: args.tabId,
              sessionId,
            });
          }
        }
      } catch (err) {
        if (isCurrent(entry, revision, "running")) {
          publishFailure(
            args.tabId,
            entry,
            failurePhase,
            err,
          );
        }
        console.error("pty start failed", err);
        await disposeSession(args.tabId, entry);
      }
    })();

    entry.chain = run.catch(() => undefined);
    return run;
  };

  const getSessionId = (tabId: string): string | null => {
    return byTab.get(tabId)?.sessionId ?? null;
  };

  const getState = (tabId: string): TerminalRuntimeState | null => {
    return byTab.get(tabId)?.runtimeState ?? null;
  };

  const subscribe = (
    tabId: string,
    listener: (state: TerminalRuntimeState) => void,
  ): (() => void) => {
    const listeners = listenersByTab.get(tabId) ?? new Set();
    listeners.add(listener);
    listenersByTab.set(tabId, listeners);
    const current = byTab.get(tabId)?.runtimeState;
    if (current) listener(current);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) listenersByTab.delete(tabId);
    };
  };

  return { start, stop, getSessionId, getState, subscribe };
}

/** Production singleton: real PTY I/O + global event multiplex. */
export const sessionController = createSessionController({
  pty: ptyApi,
  subscribeData: subscribePtyData,
  subscribeExit: subscribePtyExit,
  ensureListeners: () => ptyEventMultiplexer.ensureReady(),
  attachEvents: (sessionId, afterSeq) => ptyEventMultiplexer.attach(sessionId, afterSeq),
  diagnostics: (phase, error, context) => {
    const kind = phase === "kill" ? "pty.kill" : phase === "write" || phase === "resize"
      ? "ipc.command.fail"
      : "pty.start.fail";
    const detailError = error instanceof Error
      ? { name: error.name, message: error.message }
      : error;
    recordDiag(kind, {
      tabId: context?.tabId,
      sessionId: context?.sessionId ?? undefined,
      detail: { phase, error: detailError },
    });
  },
});
