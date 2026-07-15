import { useEffect, useState } from "react";
import {
  readText as readClipboardText,
  writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager";

import { useXterm } from "./useXterm";
import { ptyApi } from "@/features/terminal/terminal.service";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { sessionController } from "@/features/terminal/sessionController";
import { applyTerminalFit, runFitOnVisible } from "@/features/terminal/fitOnVisible";
import type { PtyExitReason } from "@/lib/events";
import { utf8ToBase64 } from "@/lib/base64";
import { WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { createFileLinkProvider } from "./terminalLinks";
import { useSessionCapture } from "@/features/resume/useSessionCapture";
import { TerminalExitBanner } from "./TerminalExitBanner";
import { TerminalSessionLoading } from "./TerminalSessionLoading";
import { isMac } from "@/lib/platform";
import { cn } from "@/lib/cn";

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
   * Whether this tab is currently the displayed one. Drives fit-on-visible
   * (WKWebView often misses ResizeObserver after display:none).
   */
  isVisible?: boolean;
}

/**
 * Process tab chrome: xterm mount, keyboard/clipboard, link provider,
 * ResizeObserver, and fit-on-visible. PTY Session lifecycle lives in the
 * Session controller.
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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [exitInfo, setExitInfo] = useState<{ code: number; reason: PtyExitReason } | null>(null);
  /** True until spawn settles (session id or failed start). Avoids blank first paint. */
  const [booting, setBooting] = useState(true);
  useSessionCapture({
    enabled: !!cliToolId,
    term: termRef.current,
    cliId: cliToolId,
    projectId,
    cwd,
    sessionId: activeSessionId,
  });
  const setLastFocused = useTerminalStore((s) => s.setLastFocused);

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

  // Session lifecycle. Cleanup awaits stop so StrictMode cannot spawn over a live kill.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    let cancelled = false;
    setExitInfo(null);
    setBooting(true);
    setActiveSessionId(null);

    void sessionController
      .start({
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
        disposed: () => disposedRef.current || cancelled,
        onSession: (id) => {
          if (cancelled) return;
          setActiveSessionId(id);
          if (id) setBooting(false);
        },
        onExit: (info) => {
          if (cancelled) return;
          setExitInfo(info);
          setBooting(false);
        },
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });

    return () => {
      cancelled = true;
      // Chain stop on the controller; do not fire-and-forget a parallel kill.
      void sessionController.stop(tabId).then(() => {
        setActiveSessionId(null);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Fit-on-visible is pure DOM policy: uses term/fit refs, not the session map.
  useEffect(() => {
    if (!isVisible) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    return runFitOnVisible({
      term,
      fit,
      getContainer: () => containerRef.current,
      scrollToBottom: true,
    });
  }, [isVisible, termRef, fitRef, containerRef]);

  // Chrome: file links, Shift+Enter, paste/copy, context menu, ResizeObserver.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    const linkProvider = term.registerLinkProvider(createFileLinkProvider(term, cwd));

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

  const showLoader = booting && !activeSessionId && !exitInfo;

  return (
    <div className="relative flex h-full w-full flex-col bg-canvas">
      {exitInfo ? (
        <TerminalExitBanner
          exitCode={exitInfo.code}
          reason={exitInfo.reason}
          sessionId={activeSessionId}
          onDismiss={() => setExitInfo(null)}
        />
      ) : null}
      <div className="relative min-h-0 flex-1">
        {showLoader ? (
          <TerminalSessionLoading label={label} phase="starting" />
        ) : null}
        {/* xterm must stay mounted under the loader so spawn can fit and attach. */}
        <div
          ref={containerRef}
          className={cn("h-full w-full", showLoader && "opacity-0")}
          data-tab-id={tabId}
          aria-hidden={showLoader || undefined}
        />
      </div>
    </div>
  );
}
