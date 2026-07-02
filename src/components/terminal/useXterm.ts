import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { CanvasAddon } from "@xterm/addon-canvas";

import { useThemeStore } from "@/features/theme/theme.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { CMD, invoke } from "@/lib/ipc";

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
  /** True once the Terminal has been disposed. Callers MUST check this before
   *  any term.write/scroll/resize call — xterm v5 throws (or silently noops)
   *  on a disposed terminal, and an in-flight pty://data chunk arriving after
   *  unmount would otherwise crash the listener. Set synchronously in the
   *  unmount cleanup, before term.dispose() runs. */
  disposedRef: React.MutableRefObject<boolean>;
}

/** Create + mount an xterm.js terminal. Theme follows the app theme reactively. */
export function useXterm(): UseXtermResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const disposedRef = useRef<boolean>(false);
  // Skip the first run of each live-apply effect below: the terminal is created
  // with the current settings via getState(), so the initial pass is a no-op we
  // don't want (an early fit() could race the deferred canvas-renderer init).
  const firstTypoRun = useRef(true);
  const firstCursorRun = useRef(true);
  const firstScrollbackRun = useRef(true);
  // Reapply on any theme switch (light↔dark *and* swaps within the same kind,
  // e.g. Tokyo Night → One Dark — both dark, different ANSI palettes).
  const themeId = useThemeStore((s) => s.theme.id);
  const termFontFamily = useSettingsDataStore((s) => s.settings.terminal.fontFamily);
  const termFontSize = useSettingsDataStore((s) => s.settings.terminal.fontSize);
  const termCursorStyle = useSettingsDataStore((s) => s.settings.terminal.cursorStyle);
  const termScrollback = useSettingsDataStore((s) => s.settings.terminal.scrollback);

  useEffect(() => {
    if (!containerRef.current) return;
    // Reset the disposed flag on every (re-)mount. React StrictMode in dev
    // intentionally runs effect setup → cleanup → setup on the same component
    // instance; the cleanup leaves `disposedRef.current === true`, which would
    // make the next mount's pty://data listener silently drop every chunk —
    // visible as a blank terminal that "doesn't load".
    disposedRef.current = false;
    const initialTerm = useSettingsDataStore.getState().settings.terminal;
    const term = new Terminal({
      fontFamily: initialTerm.fontFamily,
      fontSize: initialTerm.fontSize,
      // Must be 1.0 so box-drawing characters (─│╭╮╰╯) connect across cells —
      // anything larger creates vertical gaps that break TUI rendering
      // (Claude Code, Codex, etc.). Intentionally NOT user-configurable.
      lineHeight: 1.0,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: initialTerm.cursorStyle,
      cursorWidth: 1,
      scrollback: initialTerm.scrollback,
      allowProposedApi: true,
      smoothScrollDuration: 0,
      cols: 100,
      rows: 28,
      theme: buildTerminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Default handler calls window.open(uri), which is a no-op inside Tauri's
    // webview — route http(s) clicks through the IPC opener so they land in
    // the user's default browser.
    term.loadAddon(
      new WebLinksAddon((_ev, uri) => {
        invoke(CMD.openExternalUrl, { url: uri }).catch((err) =>
          console.warn("[term] open_external_url failed", err),
        );
      }),
    );
    term.open(containerRef.current);
    // Canvas renderer must be attached AFTER open() in xterm.js v5.5 — but
    // the open() itself can crash if it tries to fit/sync before a renderer
    // is installed. We defer the canvas attach + the first fit to the next
    // animation frame so xterm has finished its internal init. We also wait
    // for the Nerd Font to finish loading first, otherwise the canvas would
    // measure cell width using a fallback font and lock in the wrong metrics.
    const installRenderer = () => {
      try {
        term.loadAddon(new CanvasAddon());
      } catch (err) {
        console.warn("[term] CanvasAddon load failed; using DOM renderer", err);
      }
      try {
        // Only fit when actually visible — fitting a 0×0 (hidden) container
        // clamps cols to ~2 and would mangle a TUI; ResizeObserver re-fits on show.
        if (containerRef.current?.clientWidth) fit.fit();
      } catch {
        // ignore — ResizeObserver in TerminalTab will retry once sized
      }
    };
    const fontsApi = (document as any).fonts;
    const fontPromise = fontsApi
      ? fontsApi.load(`${initialTerm.fontSize}px ${initialTerm.fontFamily}`).catch(() => undefined)
      : Promise.resolve();
    fontPromise.finally(() => requestAnimationFrame(installRenderer));
    termRef.current = term;
    fitRef.current = fit;

    return () => {
      // Flip the disposed flag BEFORE term.dispose() so any pending
      // pty://data listener short-circuits instead of writing to a corpse.
      disposedRef.current = true;
      termRef.current = null;
      fitRef.current = null;
      term.dispose();
    };
    // we intentionally only mount/dispose once; the inner term lives across theme changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme reactivity: re-apply when the active palette changes
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = buildTerminalTheme();
  }, [themeId]);

  // Live-apply terminal typography. Font size/family change cell metrics, so we
  // refit — and load the family first so the canvas renderer measures the right
  // glyph width.
  useEffect(() => {
    if (firstTypoRun.current) {
      firstTypoRun.current = false;
      return;
    }
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term) return;
    term.options.fontSize = termFontSize;
    term.options.fontFamily = termFontFamily;
    const refit = () => {
      try {
        if (containerRef.current?.clientWidth) fit?.fit();
      } catch {
        // ResizeObserver in TerminalTab will retry once sized
      }
    };
    const fontsApi = (document as any).fonts;
    if (fontsApi) {
      fontsApi.load(`${termFontSize}px ${termFontFamily}`).then(refit).catch(refit);
    } else {
      refit();
    }
  }, [termFontSize, termFontFamily]);

  // Cursor style — pure visual, no refit.
  useEffect(() => {
    if (firstCursorRun.current) {
      firstCursorRun.current = false;
      return;
    }
    if (termRef.current) termRef.current.options.cursorStyle = termCursorStyle;
  }, [termCursorStyle]);

  // Scrollback — grows live; shrinking only fully applies to new terminals
  // (xterm keeps already-buffered lines until they scroll out).
  useEffect(() => {
    if (firstScrollbackRun.current) {
      firstScrollbackRun.current = false;
      return;
    }
    if (termRef.current) termRef.current.options.scrollback = termScrollback;
  }, [termScrollback]);

  return { containerRef, termRef, fitRef, disposedRef };
}
