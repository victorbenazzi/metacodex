import { useEffect, useState } from "react";
import {
  readText as readClipboardText,
  writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager";

import { useXterm } from "./useXterm";
import { ptyApi } from "@/features/terminal/terminal.service";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import {
  sessionController,
} from "@/features/terminal/sessionController";
import { applyTerminalFit } from "@/features/terminal/fitOnVisible";
import type { PtyExitReason } from "@/lib/events";
import { utf8ToBase64 } from "@/lib/base64";
import { WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { createFileLinkProvider } from "./terminalLinks";
import { useSessionCapture } from "@/features/resume/useSessionCapture";
import { TerminalExitBanner } from "./TerminalExitBanner";
import { isMac } from "@/lib/platform";

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
  /**
   * Whether this tab is currently the displayed one. Drives Session controller
   * fit-on-visible (WKWebView often misses ResizeObserver after display:none).
   */
  isVisible?: boolean;
}

/**
 * Process tab chrome: xterm mount, keyboard/clipboard, link provider, and
 * ResizeObserver. PTY Session lifecycle lives in the Session controller.
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
  isVisible = true,
}: TerminalTabProps) {
  const { containerRef, termRef, fitRef, disposedRef } = useXterm();
  // Mirrored from Session controller so useSessionCapture and the exit banner
  // re-render when the PTY Session id lands.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [exitInfo, setExitInfo] = useState<{ code: number; reason: PtyExitReason } | null>(null);
  useSessionCapture({
    enabled: !!cliToolId,
    term: termRef.current,
    cliId: cliToolId,
    projectId,
    cwd,
    sessionId: activeSessionId,
  });
  const setLastFocused = useTerminalStore((s) => s.setLastFocused);

  // Track focus so the editor's "send selection to terminal" knows which
  // terminal to target (the last one the user interacted with in this project).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onFocusIn = () => {
      const sid = sessionController.getSessionId(tabId);
      if (sid) setLastFocused(projectId ?? WORKSPACE_NULL, sid);
    };
    el.addEventListener("focusin", onFocusIn);
    return () => el.removeEventListener("focusin", onFocusIn);
  }, [projectId, setLastFocused, containerRef, tabId]);

  // Session controller: spawn, pump, OSC/heuristic, kill on unmount.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    setExitInfo(null);
    void sessionController.start({
      tabId,
      projectId,
      cwd,
      label,
      cliLaunchCommand,
      cliToolId,
      prefillCommand,
      term,
      fit,
      getContainer: () => containerRef.current,
      disposed: () => disposedRef.current,
      onSession: setActiveSessionId,
      onExit: setExitInfo,
    });

    return () => {
      void sessionController.stop(tabId).then(() => setActiveSessionId(null));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  useEffect(() => {
    sessionController.onVisible(tabId, isVisible);
  }, [tabId, isVisible]);

  // Chrome: file links, Shift+Enter, paste/copy, context menu, ResizeObserver.
  // Kept here because they are DOM/input policy, not PTY Session lifecycle.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    const linkProvider = term.registerLinkProvider(createFileLinkProvider(term, cwd));

    // Shift+Enter → ESC+CR (newline without submit for ink/readline/bubbletea).
    // Returning false from attachCustomKeyEventHandler skips xterm's keydown path
    // including its preventDefault; we must preventDefault ourselves or WKWebView
    // inserts a stray `\n` after our `\x1b\r`. Match `ev.code === "Enter"` too
    // (ABNT2 / AZERTY localize `ev.key`).
    const pasteFromClipboard = () => {
      void readClipboardText()
        .then((text) => {
          if (text) term.paste(text);
        })
        .catch((err) => console.warn("[term] clipboard read failed", err));
    };

    term.attachCustomKeyEventHandler((ev) => {
      const isEnter = ev.key === "Enter" || ev.code === "Enter" || ev.keyCode === 13;
      if (ev.type === "keydown" && isEnter && ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        const sid = sessionController.getSessionId(tabId);
        if (sid) {
          ptyApi.write(sid, utf8ToBase64("\x1b\r")).catch(() => undefined);
        }
        return false;
      }
      const primaryMod = isMac
        ? ev.metaKey && !ev.ctrlKey
        : ev.ctrlKey && !ev.metaKey;
      const isV = ev.key === "v" || ev.key === "V" || ev.code === "KeyV";
      if (ev.type === "keydown" && isV && primaryMod && !ev.altKey) {
        ev.preventDefault();
        ev.stopPropagation();
        pasteFromClipboard();
        return false;
      }
      const isC = ev.key === "c" || ev.key === "C" || ev.code === "KeyC";
      if (
        ev.type === "keydown" &&
        isC &&
        primaryMod &&
        !ev.altKey &&
        !ev.shiftKey &&
        term.hasSelection()
      ) {
        const selection = term.getSelection();
        if (selection) {
          ev.preventDefault();
          ev.stopPropagation();
          void writeClipboardText(selection).catch((err) =>
            console.warn("[term] clipboard write failed", err),
          );
          term.clearSelection();
          return false;
        }
      }
      return true;
    });

    const onTerminalContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      pasteFromClipboard();
    };
    const containerEl = containerRef.current;
    containerEl?.addEventListener("contextmenu", onTerminalContextMenu);

    // Re-fit on container resize. Coalesce bursts into one fit per frame.
    // Do not fit while hidden (display:none → 0×0 clamps cols ~2).
    const container = containerRef.current;
    let ro: ResizeObserver | undefined;
    let fitRaf = 0;
    if (container) {
      const schedule = () => {
        if (fitRaf) return;
        fitRaf = requestAnimationFrame(() => {
          fitRaf = 0;
          const f = fitRef.current;
          const t = termRef.current;
          if (!f || !t || !container.clientWidth || !container.clientHeight) return;
          try {
            applyTerminalFit(t, f);
          } catch {
            // ignore
          }
        });
      };
      ro = new ResizeObserver(schedule);
      ro.observe(container);
    }

    return () => {
      ro?.disconnect();
      if (fitRaf) cancelAnimationFrame(fitRaf);
      linkProvider.dispose();
      containerEl?.removeEventListener("contextmenu", onTerminalContextMenu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, cwd]);

  return (
    <div className="flex h-full w-full flex-col bg-canvas">
      {exitInfo ? (
        <TerminalExitBanner
          exitCode={exitInfo.code}
          reason={exitInfo.reason}
          sessionId={activeSessionId}
          onDismiss={() => setExitInfo(null)}
        />
      ) : null}
      <div ref={containerRef} className="min-h-0 flex-1" data-tab-id={tabId} />
    </div>
  );
}
