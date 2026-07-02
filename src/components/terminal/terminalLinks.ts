import type { Terminal, ILink, ILinkProvider } from "@xterm/xterm";

import { usePendingGotoStore } from "@/features/search/search.store";
import { getAppCommands } from "@/app/appCommands";

// Matches things like `src/app/AppShell.tsx:42`, `./foo.rs:10:5`, `/abs/x.py:3`.
// Requiring a real `.ext` before the first `:` keeps timestamps (12:34:56) and
// bare `host:port` out. URLs are left to the WebLinksAddon.
const FILE_LINE_RE = /((?:\.{0,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.[\w]+):(\d+)(?::(\d+))?/g;

/**
 * xterm link provider that turns `file:line[:col]` references in terminal
 * output into clickable links which open the file in the editor at that line.
 * Paths resolve against the session's `cwd` (its initial cwd, if you `cd`, the
 * stored value won't follow, so relative links can miss; absolute paths always
 * work).
 */
export function createFileLinkProvider(term: Terminal, cwd: string): ILinkProvider {
  return {
    provideLinks(y: number, callback: (links: ILink[] | undefined) => void) {
      const bufferLine = term.buffer.active.getLine(y - 1);
      if (!bufferLine) {
        callback(undefined);
        return;
      }
      const text = bufferLine.translateToString(true);
      const links: ILink[] = [];
      FILE_LINE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FILE_LINE_RE.exec(text)) !== null) {
        const full = m[0];
        const rel = m[1];
        const lineNo = parseInt(m[2], 10);
        const startX = m.index + 1; // xterm columns are 1-based
        links.push({
          text: full,
          range: { start: { x: startX, y }, end: { x: startX + full.length - 1, y } },
          decorations: { pointerCursor: true, underline: true },
          activate: () => openInEditor(cwd, rel, lineNo),
        });
      }
      callback(links.length ? links : undefined);
    },
  };
}

function openInEditor(cwd: string, rel: string, lineNo: number) {
  const abs = resolvePath(cwd, rel);
  const name = abs.split("/").pop() ?? abs;
  // Schedule the line jump before opening so the editor honours it on mount.
  usePendingGotoStore.getState().set(`f-${abs}`, lineNo);
  getAppCommands()?.openFile(abs, name);
}

function resolvePath(cwd: string, p: string): string {
  return normalize(p.startsWith("/") ? p : `${cwd.replace(/\/+$/, "")}/${p}`);
}

function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}
