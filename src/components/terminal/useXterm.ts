import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { CanvasAddon } from "@xterm/addon-canvas";

import { useThemeStore } from "@/features/theme/theme.store";

/** Read a CSS variable from :root / [data-theme]. */
function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function buildTerminalTheme(): ITheme {
  return {
    background: readVar("--term-bg"),
    foreground: readVar("--term-fg"),
    cursor: readVar("--term-cursor"),
    cursorAccent: readVar("--term-bg"),
    selectionBackground: readVar("--term-selection"),
    black: readVar("--term-black"),
    red: readVar("--term-red"),
    green: readVar("--term-green"),
    yellow: readVar("--term-yellow"),
    blue: readVar("--term-blue"),
    magenta: readVar("--term-magenta"),
    cyan: readVar("--term-cyan"),
    white: readVar("--term-white"),
    brightBlack: readVar("--term-bright-black"),
    brightRed: readVar("--term-bright-red"),
    brightGreen: readVar("--term-bright-green"),
    brightYellow: readVar("--term-bright-yellow"),
    brightBlue: readVar("--term-bright-blue"),
    brightMagenta: readVar("--term-bright-magenta"),
    brightCyan: readVar("--term-bright-cyan"),
    brightWhite: readVar("--term-bright-white"),
  };
}

export interface UseXtermResult {
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  termRef: React.MutableRefObject<Terminal | null>;
  fitRef: React.MutableRefObject<FitAddon | null>;
}

/** Create + mount an xterm.js terminal. Theme follows the app theme reactively. */
export function useXterm(): UseXtermResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const themeEffective = useThemeStore((s) => s.effective);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 1,
      scrollback: 10_000,
      allowProposedApi: true,
      smoothScrollDuration: 0,
      cols: 100,
      rows: 28,
      theme: buildTerminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    // Canvas renderer must be attached AFTER open() in xterm.js v5.5 — but
    // the open() itself can crash if it tries to fit/sync before a renderer
    // is installed. We defer the canvas attach + the first fit to the next
    // animation frame so xterm has finished its internal init.
    requestAnimationFrame(() => {
      try {
        term.loadAddon(new CanvasAddon());
      } catch (err) {
        console.warn("[term] CanvasAddon load failed; using DOM renderer", err);
      }
      try {
        fit.fit();
      } catch {
        // ignore — ResizeObserver in TerminalTab will retry once sized
      }
    });
    termRef.current = term;
    fitRef.current = fit;

    return () => {
      termRef.current = null;
      fitRef.current = null;
      term.dispose();
    };
    // we intentionally only mount/dispose once; the inner term lives across theme changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme reactivity: re-apply when effective theme changes
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = buildTerminalTheme();
  }, [themeEffective]);

  return { containerRef, termRef, fitRef };
}
