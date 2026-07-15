import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import i18n from "@/features/i18n/config";
import { useAgentStatusStore } from "@/features/terminal/agent-status.store";
import { dispatchAgentNotification } from "@/features/terminal/notificationDispatch";
import { subscribePtyData, subscribePtyExit } from "@/features/terminal/ptyEvents";
import { ptyApi } from "@/features/terminal/terminal.service";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import type { PtySpawnSpec } from "@/features/terminal/terminal.types";
import { createAgentHeuristic } from "@/components/terminal/agentHeuristic";
import { installOscHandlers } from "@/components/terminal/oscHandlers";
import { useTabsStore, WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { base64ToUint8Array, utf8ToBase64 } from "@/lib/base64";
import type { PtyExitReason } from "@/lib/events";
import { CMD, invoke } from "@/lib/ipc";
import { applyTerminalFit, runFitOnVisible } from "./fitOnVisible";

const AGENT_TITLE_MAX = 40;

/**
 * Clean up a raw OSC 0/1/2 payload before storing it as the tab's agentTitle.
 * Strips C0/C1 control bytes, removes invisible/bidi formatting characters
 * (some agents emit BOMs/zero-width chars that would render as gaps), collapses
 * whitespace, trims, and caps the length so a verbose agent doesn't blow up
 * the tab width. Returns null if the result is empty or coincides with the
 * default label (no point overriding with the same string).
 */
export function sanitizeAgentTitle(raw: string, defaultTitle: string): string | null {
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
  // Strip invisible/bidi: ZWSP, ZWNJ, ZWJ, LRM/RLM, BOM, LRE/RLE/PDF/LRO/RLO,
  // word-joiner, narrow no-break space.
  s = s.replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff\u00ad\u202f]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > AGENT_TITLE_MAX) s = s.slice(0, AGENT_TITLE_MAX - 1) + "…";
  if (s === defaultTitle) return null;
  return s;
}

export type PtyIo = {
  spawn: typeof ptyApi.spawn;
  kill: typeof ptyApi.kill;
  write: typeof ptyApi.write;
  resize: typeof ptyApi.resize;
};

export type SessionControllerDeps = {
  pty: PtyIo;
  subscribeData: typeof subscribePtyData;
  subscribeExit: typeof subscribePtyExit;
};

export type StartArgs = {
  tabId: string;
  projectId: string | null;
  cwd: string;
  label: string;
  cliLaunchCommand?: string;
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
  startGeneration: number;
  cleanups: Array<() => void>;
  term: Terminal | null;
  fit: FitAddon | null;
  getContainer: (() => HTMLElement | null) | null;
  disposed: (() => boolean) | null;
  cancelFitOnVisible: (() => void) | null;
};

export type SessionController = {
  start(args: StartArgs): Promise<void>;
  stop(tabId: string): Promise<void>;
  onVisible(tabId: string, visible: boolean): void;
  getSessionId(tabId: string): string | null;
};

function createEntry(): LiveEntry {
  return {
    sessionId: null,
    startGeneration: 0,
    cleanups: [],
    term: null,
    fit: null,
    getContainer: null,
    disposed: null,
    cancelFitOnVisible: null,
  };
}

/**
 * Session controller: owns PTY Session lifecycle for Process tabs.
 * Callers (TerminalTab, project teardown, Tab lifecycle) use tabId only.
 */
export function createSessionController(deps: SessionControllerDeps): SessionController {
  const byTab = new Map<string, LiveEntry>();

  const getOrCreate = (tabId: string): LiveEntry => {
    let entry = byTab.get(tabId);
    if (!entry) {
      entry = createEntry();
      byTab.set(tabId, entry);
    }
    return entry;
  };

  const runCleanups = (entry: LiveEntry) => {
    const list = entry.cleanups.splice(0, entry.cleanups.length);
    for (const fn of list) {
      try {
        fn();
      } catch (err) {
        console.warn("[sessionController] cleanup failed", err);
      }
    }
  };

  const stop = async (tabId: string): Promise<void> => {
    const entry = byTab.get(tabId);
    if (!entry) return;

    entry.startGeneration += 1;
    entry.cancelFitOnVisible?.();
    entry.cancelFitOnVisible = null;

    const sessionId = entry.sessionId;
    entry.sessionId = null;
    runCleanups(entry);

    useAgentStatusStore.getState().clear(tabId);

    if (sessionId) {
      await deps.pty.kill(sessionId).catch(() => undefined);
      useTerminalStore.getState().remove(sessionId);
    }

    byTab.delete(tabId);
  };

  const start = async (args: StartArgs): Promise<void> => {
    // Replace any prior live entry for this tab (StrictMode remount / restart).
    if (byTab.has(args.tabId)) {
      await stop(args.tabId);
    }

    const entry = getOrCreate(args.tabId);
    const generation = ++entry.startGeneration;
    entry.term = args.term;
    entry.fit = args.fit;
    entry.getContainer = args.getContainer;
    entry.disposed = args.disposed;
    args.onSession?.(null);

    const projectKey = args.projectId ?? WORKSPACE_NULL;
    const term = args.term;
    const fit = args.fit;

    let lastCwdPushed: string | null = null;
    let lastAgentTitlePushed: string | null = null;

    const oscDisposables = installOscHandlers(term, {
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
        const current = useAgentStatusStore.getState().byTab[args.tabId]?.status;
        if (current === "needs-attention" && status === "working") return;
        useAgentStatusStore.getState().setStatus(args.tabId, status, hint);
      },
    });
    entry.cleanups.push(() => heuristic.dispose());

    const doneSweeper = window.setInterval(() => {
      const e = useAgentStatusStore.getState().byTab[args.tabId];
      if (e && e.status === "done" && Date.now() - e.changedAt > 4000) {
        useAgentStatusStore.getState().clear(args.tabId);
      }
    }, 1000);
    entry.cleanups.push(() => window.clearInterval(doneSweeper));

    // Wait two animation frames so xterm has time to initialize its renderer
    // before we begin writing PTY data. Without this we can race xterm's
    // internal `_renderer.value.dimensions` getter and crash on first write.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    if (generation !== entry.startGeneration || !byTab.has(args.tabId)) {
      return;
    }

    try {
      // Skip if hidden: fitting a 0×0 container clamps cols to ~2.
      if (args.getContainer()?.clientWidth) {
        applyTerminalFit(term, fit);
      }
    } catch {
      // ResizeObserver / onVisible will retry
    }

    if (generation !== entry.startGeneration || !byTab.has(args.tabId)) {
      return;
    }

    const localKind = args.cliLaunchCommand ? "cli" : "shell";

    try {
      const rows = term.rows || 24;
      const cols = term.cols || 80;
      const spec: Omit<PtySpawnSpec, "theme_kind"> = {
        project_id: args.projectId,
        cwd: args.cwd,
        rows,
        cols,
        kind: args.cliLaunchCommand
          ? { kind: "cli", command: args.cliLaunchCommand }
          : { kind: "plain" },
        label: args.label,
        cli_id: args.cliToolId,
      };
      const sessionId = await deps.pty.spawn(spec);

      if (generation !== entry.startGeneration || !byTab.has(args.tabId)) {
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
        status: "running",
        createdAt: new Date().toISOString(),
      });

      let prefillWritten = false;
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
          setTimeout(() => {
            deps.pty.write(sessionId, utf8ToBase64(cmd)).catch(() => undefined);
          }, 200);
        }
      });
      entry.cleanups.push(unlistenData);

      const unlistenExit = deps.subscribeExit(sessionId, (payload) => {
        const reason = (payload.reason ?? "normal") as PtyExitReason;
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
        deps.pty.write(sid, utf8ToBase64(d)).catch(() => undefined);
      });
      const resizeDisposable = term.onResize(({ rows: r, cols: c }) => {
        const sid = entry.sessionId;
        if (!sid) return;
        deps.pty.resize(sid, r, c).catch(() => undefined);
      });
      entry.cleanups.push(() => {
        dataDisposable.dispose();
        resizeDisposable.dispose();
      });

      try {
        await deps.pty.resize(sessionId, term.rows, term.cols);
      } catch {
        // ignore
      }
    } catch (err) {
      console.error("pty spawn failed", err);
    }
  };

  const onVisible = (tabId: string, visible: boolean): void => {
    const entry = byTab.get(tabId);
    if (!entry) return;

    entry.cancelFitOnVisible?.();
    entry.cancelFitOnVisible = null;

    if (!visible) return;
    const term = entry.term;
    const fit = entry.fit;
    const getContainer = entry.getContainer;
    if (!term || !fit || !getContainer) return;

    entry.cancelFitOnVisible = runFitOnVisible({
      term,
      fit,
      getContainer,
      scrollToBottom: true,
    });
  };

  const getSessionId = (tabId: string): string | null => {
    return byTab.get(tabId)?.sessionId ?? null;
  };

  return { start, stop, onVisible, getSessionId };
}

/** Production singleton: real PTY I/O + global event multiplex. */
export const sessionController = createSessionController({
  pty: {
    spawn: (spec) => ptyApi.spawn(spec),
    kill: (id) => ptyApi.kill(id),
    write: (id, data) => ptyApi.write(id, data),
    resize: (id, rows, cols) => ptyApi.resize(id, rows, cols),
  },
  subscribeData: subscribePtyData,
  subscribeExit: subscribePtyExit,
});
