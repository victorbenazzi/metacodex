import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Button } from "@/components/ui/Button";
import { AlertTriangle } from "@/components/ui/icons";
import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";
import { requestCloseTab } from "@/features/tabs/tabLifecycle";
import type { TerminalRuntimeState } from "@/features/terminal/terminal.types";

interface TerminalTabProps {
  tabId: string;
  cwd: string;
  projectId: string | null;
  /** If set, launch this CLI via login shell; otherwise plain shell. */
  cliLaunchCommand?: string;
  cliLaunch?: {
    executable: string;
    args: string[];
    environment: Record<string, string>;
  };
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
  cliLaunch,
  cliToolId,
  label,
  prefillCommand,
  isVisible = true,
}: TerminalTabProps) {
  const { t } = useTranslation();
  const { containerRef, termRef, fitRef, disposedRef } = useXterm();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [exitInfo, setExitInfo] = useState<{ code: number; reason: PtyExitReason } | null>(null);
  const [runtimeState, setRuntimeState] = useState<TerminalRuntimeState>({
    phase: "starting",
    step: "listeners",
  });
  const [retryRevision, setRetryRevision] = useState(0);
  useSessionCapture({
    tabId,
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
    setRuntimeState({ phase: "starting", step: "listeners" });
    setActiveSessionId(null);
    const unsubscribeState = sessionController.subscribe(tabId, (state) => {
      if (!cancelled) setRuntimeState(state);
    });

    void sessionController.start({
        tabId,
        projectId,
        cwd,
        label,
        cliLaunchCommand,
        cliLaunch,
        cliToolId,
        prefillCommand,
        term,
        fit,
        getContainer: () => containerRef.current,
        disposed: () => disposedRef.current || cancelled,
        onSession: (id) => {
          if (cancelled) return;
          setActiveSessionId(id);
        },
        onExit: (info) => {
          if (cancelled) return;
          setExitInfo(info);
        },
      });

    return () => {
      cancelled = true;
      unsubscribeState();
      // Chain stop on the controller; do not fire-and-forget a parallel kill.
      void sessionController.stop(tabId).then(() => {
        setActiveSessionId(null);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, retryRevision]);

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

  const showLoader = runtimeState.phase === "starting";
  const failure = runtimeState.phase === "failed" ? runtimeState : null;
  const projectKey = projectId ?? WORKSPACE_NULL;

  const copyDiagnostics = () => {
    const payload = JSON.stringify(
      {
        tabId,
        projectId,
        cwd,
        label,
        runtimeState,
        log: useDiagnosticsStore.getState().entries,
      },
      null,
      2,
    );
    void writeClipboardText(payload);
  };

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
        {failure ? (
          <div
            role="alert"
            className="absolute inset-0 z-10 flex items-center justify-center bg-canvas px-[var(--space-xl)]"
          >
            <div className="w-full max-w-[520px] rounded-md border border-hairline bg-surface p-[var(--space-lg)] shadow-elevated">
              <div className="flex items-start gap-[var(--space-sm)]">
                <AlertTriangle size={18} className="mt-[2px] flex-none text-danger" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-title font-semibold text-ink">
                    {t("terminal.failure.title")}
                  </h2>
                  <p className="mt-[var(--space-xs)] text-caption text-ink-muted">
                    {t("terminal.failure.step", {
                      step: t(`terminal.failure.steps.${failure.step}`),
                    })}
                  </p>
                  <pre className="mt-[var(--space-base)] max-h-[160px] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-strong/50 p-[var(--space-sm)] text-caption text-ink">
                    {failure.error.code}: {failure.error.message}
                  </pre>
                  <div className="mt-[var(--space-base)] flex flex-wrap gap-[var(--space-xs)]">
                    {failure.retryable ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setRetryRevision((value) => value + 1)}
                      >
                        {t("common.retry")}
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" onClick={copyDiagnostics}>
                      {t("terminal.failure.copyDiagnostics")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => requestCloseTab(projectKey, tabId)}
                    >
                      {t("tabs.closeTab")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {/* xterm must stay mounted under the loader so spawn can fit and attach. */}
        <div
          ref={containerRef}
          className={cn("h-full w-full", (showLoader || failure) && "opacity-0")}
          data-tab-id={tabId}
          aria-hidden={showLoader || failure ? true : undefined}
        />
      </div>
    </div>
  );
}
