import { useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { useXterm } from "./useXterm";
import i18n from "@/features/i18n/config";
import { ptyApi } from "@/features/terminal/terminal.service";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import type { PtySpawnSpec } from "@/features/terminal/terminal.types";
import { EV, listenTo, type PtyDataPayload, type PtyExitPayload } from "@/lib/events";
import { base64ToUint8Array, utf8ToBase64 } from "@/lib/base64";
import { WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { createFileLinkProvider } from "./terminalLinks";

interface TerminalTabProps {
  tabId: string;
  cwd: string;
  projectId: string | null;
  /** If set, launch this CLI via login shell; otherwise plain shell. */
  cliLaunchCommand?: string;
  cliToolId?: string;
  label: string;
  /** Text written to the PTY after the shell prints its first byte (no
   * trailing Enter). Used to pre-fill install commands. */
  prefillCommand?: string;
}

/**
 * A single terminal tab: owns its xterm instance, spawns a PTY on mount,
 * pipes data both ways, kills the PTY on unmount.
 *
 * The parent (TabContent) keeps this mounted with display:none while inactive
 * so PTY state and xterm scrollback survive tab switches.
 */
export function TerminalTab({
  tabId,
  cwd,
  projectId,
  cliLaunchCommand,
  cliToolId,
  label,
  prefillCommand,
}: TerminalTabProps) {
  const { containerRef, termRef, fitRef } = useXterm();
  const sessionIdRef = useRef<string | null>(null);
  const registerSession = useTerminalStore((s) => s.register);
  const setStatus = useTerminalStore((s) => s.setStatus);
  const removeSession = useTerminalStore((s) => s.remove);
  const setLastFocused = useTerminalStore((s) => s.setLastFocused);

  // Track focus so the editor's "send selection to terminal" knows which
  // terminal to target (the last one the user interacted with in this project).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onFocusIn = () => {
      const sid = sessionIdRef.current;
      if (sid) setLastFocused(projectId ?? WORKSPACE_NULL, sid);
    };
    el.addEventListener("focusin", onFocusIn);
    return () => el.removeEventListener("focusin", onFocusIn);
  }, [projectId, setLastFocused, containerRef]);

  useEffect(() => {
    let cancelled = false;
    let unlistenData: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;

    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    // Make `file:line` references in output clickable → open in the editor.
    const linkProvider = term.registerLinkProvider(createFileLinkProvider(term, cwd));

    // Shift+Enter → send ESC+CR (the Alt/Option+Enter byte sequence), which
    // ink / readline / prompt-kit interpret as "insert newline without
    // submit". Plain Enter on a PTY is just `\r` with no modifier bits, so
    // without this CLIs like Claude Code, Codex, and opencode can't tell
    // Shift+Enter apart from Enter.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === "keydown" && ev.key === "Enter" && ev.shiftKey) {
        const sid = sessionIdRef.current;
        if (sid) {
          ptyApi.write(sid, utf8ToBase64("\x1b\r")).catch(() => undefined);
        }
        return false;
      }
      return true;
    });

    // Pre-register a placeholder session so UI can show "starting"
    const localKind = cliLaunchCommand ? "cli" : "shell";

    (async () => {
      // Wait two animation frames so xterm has time to initialize its renderer
      // before we begin writing PTY data. Without this we can race xterm's
      // internal `_renderer.value.dimensions` getter and crash on first write.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      try {
        // Skip if hidden (e.g. user switched tabs during those frames) — fitting
        // a 0×0 container clamps cols to ~2; the ResizeObserver re-fits on show.
        if (containerRef.current?.clientWidth) fit.fit();
      } catch {
        // ignore — observer below will retry
      }

      try {
        const rows = term.rows || 24;
        const cols = term.cols || 80;
        const spec: PtySpawnSpec = {
          project_id: projectId,
          cwd,
          rows,
          cols,
          kind: cliLaunchCommand
            ? { kind: "cli", command: cliLaunchCommand }
            : { kind: "plain" },
          label,
          cli_id: cliToolId,
        };
        const sessionId = await ptyApi.spawn(spec);
        if (cancelled) {
          await ptyApi.kill(sessionId).catch(() => undefined);
          return;
        }
        sessionIdRef.current = sessionId;
        registerSession({
          id: sessionId,
          tabId,
          projectId,
          cwd,
          kind: localKind,
          cliToolId,
          title: label,
          status: "running",
          createdAt: new Date().toISOString(),
        });

        let prefillWritten = false;
        unlistenData = await listenTo<PtyDataPayload>(EV.ptyData, (e) => {
          if (e.payload.session_id !== sessionId) return;
          const bytes = base64ToUint8Array(e.payload.data_b64);
          try {
            term.write(bytes);
          } catch (writeErr) {
            console.warn("[pty] term.write failed", writeErr);
          }
          // Pre-fill the install command once after the shell prints its prompt.
          // Small delay lets the prompt finish redrawing before our typed chars land.
          if (!prefillWritten && prefillCommand) {
            prefillWritten = true;
            setTimeout(() => {
              ptyApi
                .write(sessionId, utf8ToBase64(prefillCommand))
                .catch(() => undefined);
            }, 200);
          }
        });
        unlistenExit = await listenTo<PtyExitPayload>(EV.ptyExit, (e) => {
          if (e.payload.session_id !== sessionId) return;
          term.writeln(`\r\n\x1b[2m${i18n.t("terminal.processExited")}\x1b[0m`);
          setStatus(sessionId, "exited", e.payload.exit_code);
        });

        const dataDisposable = term.onData((d) => {
          const sid = sessionIdRef.current;
          if (!sid) return;
          ptyApi.write(sid, utf8ToBase64(d)).catch(() => undefined);
        });
        const resizeDisposable = term.onResize(({ rows, cols }) => {
          const sid = sessionIdRef.current;
          if (!sid) return;
          ptyApi.resize(sid, rows, cols).catch(() => undefined);
        });

        // Attach disposables so they get cleaned up on dispose. Term will dispose
        // them automatically when dispose() is called, but we capture in case.
        (term as any).__metacodexDisposables = [dataDisposable, resizeDisposable];

        // Send an initial resize after listeners are attached so backend knows
        // the real dimensions (xterm may have already fired onResize before we listened).
        try {
          await ptyApi.resize(sessionId, term.rows, term.cols);
        } catch {
          // ignore
        }
      } catch (err) {
        console.error("pty spawn failed", err);
      }
    })();

    // Re-fit on container resize
    const container = containerRef.current;
    let ro: ResizeObserver | undefined;
    if (container) {
      ro = new ResizeObserver(() => {
        const f = fitRef.current;
        // Don't fit while the tab is hidden (display:none → 0×0). FitAddon would
        // clamp to its minimum cols (~2) and resize the PTY to that, mangling
        // TUIs like Claude Code into one-char-per-line. The observer fires again
        // with real dimensions when the tab is shown, which re-fits correctly.
        if (!f || !container.clientWidth || !container.clientHeight) return;
        try {
          f.fit();
        } catch {
          // ignore
        }
      });
      ro.observe(container);
    }

    return () => {
      cancelled = true;
      ro?.disconnect();
      linkProvider.dispose();
      unlistenData?.();
      unlistenExit?.();
      const sid = sessionIdRef.current;
      if (sid) {
        ptyApi.kill(sid).catch(() => undefined);
        removeSession(sid);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  return <div ref={containerRef} className="h-full w-full bg-canvas" data-tab-id={tabId} />;
}
