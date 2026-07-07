import { useCallback, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Trash2, Copy, FileBadge } from "lucide-react";

import {
  useDiagnosticsStore,
  type DiagEntry,
  type DiagKind,
} from "@/features/diagnostics/diagnostics.store";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";

/** Map each kind to a 1-letter glyph + token-driven swatch. Keeps the list
 *  scannable at a glance without coloring every row. */
const KIND_META: Record<DiagKind, { letter: string; tone: "ink" | "success" | "warn" | "danger" }> = {
  "pty.spawn":           { letter: "P", tone: "ink" },
  "pty.exit":            { letter: "P", tone: "ink" },
  "pty.kill":            { letter: "P", tone: "warn" },
  "pty.backpressure":    { letter: "P", tone: "warn" },
  "pty.reader_error":    { letter: "P", tone: "danger" },
  "fs.changed":          { letter: "F", tone: "ink" },
  "fs.error":            { letter: "F", tone: "danger" },
  "fs.renamed":          { letter: "F", tone: "ink" },
  "workspace.save.ok":   { letter: "W", tone: "success" },
  "workspace.save.fail": { letter: "W", tone: "danger" },
  "workspace.load.fail": { letter: "W", tone: "danger" },
  "ipc.command.fail":    { letter: "I", tone: "danger" },
  "tab.remap":           { letter: "T", tone: "ink" },
  "tab.close_external":  { letter: "T", tone: "warn" },
  "app.before_quit":     { letter: "A", tone: "ink" },
  "error_boundary.caught": { letter: "E", tone: "danger" },
};

const TONE_CLASSES: Record<"ink" | "success" | "warn" | "danger", string> = {
  ink: "text-muted",
  success: "text-success",
  warn: "text-warn",
  danger: "text-danger",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

interface DiagRowProps {
  entry: DiagEntry;
  onPickSession: (sid: string | null) => void;
}

function DiagRow({ entry, onPickSession }: DiagRowProps) {
  const meta = KIND_META[entry.kind];
  const detailStr = entry.detail ? JSON.stringify(entry.detail) : "";
  return (
    <div className="grid grid-cols-[14px_72px_minmax(0,1fr)] gap-[var(--space-xs)] border-b border-hairline-soft py-[6px] px-[var(--space-sm)] text-caption leading-[1.4]">
      <span className={cn("font-mono font-semibold text-center", TONE_CLASSES[meta.tone])}>
        {meta.letter}
      </span>
      <span className="font-mono tabular-nums text-muted-soft">{fmtTime(entry.ts)}</span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-[var(--space-xs)]">
          <span className="font-medium text-ink">{entry.kind}</span>
          {entry.sessionId ? (
            <button
              type="button"
              onClick={() => onPickSession(entry.sessionId!)}
              className="font-mono text-micro text-muted-soft hover:text-ink"
              title={entry.sessionId}
            >
              s:{entry.sessionId.slice(0, 6)}
            </button>
          ) : null}
          {entry.tabId ? (
            <span className="font-mono text-micro text-muted-soft" title={entry.tabId}>
              t:{entry.tabId.slice(0, 6)}
            </span>
          ) : null}
          {entry.projectId ? (
            <span className="font-mono text-micro text-muted-soft" title={entry.projectId}>
              p:{entry.projectId.slice(0, 6)}
            </span>
          ) : null}
        </div>
        {detailStr ? (
          <div className="font-mono text-label text-body break-all whitespace-pre-wrap">
            {detailStr}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Diagnostic log panel: overlay docked on the right edge. Surfaces the
 *  in-memory ring buffer of recent PTY / FS / workspace / IPC events. Toggle
 *  with Cmd+Shift+D. Mounted at the App root so it's available regardless of
 *  active project. */
export function DiagnosticLogPanel() {
  const { t } = useTranslation();
  const open = useDiagnosticsStore((s) => s.open);
  const entries = useDiagnosticsStore((s) => s.entries);
  const filters = useDiagnosticsStore((s) => s.filters);
  const setOpen = useDiagnosticsStore((s) => s.setOpen);
  const setKindFilter = useDiagnosticsStore((s) => s.setKindFilter);
  const setSessionIdFilter = useDiagnosticsStore((s) => s.setSessionIdFilter);
  const clear = useDiagnosticsStore((s) => s.clear);
  const serialize = useDiagnosticsStore((s) => s.serialize);

  const filtered = useMemo(() => {
    const kf = filters.kindFilter.trim().toLowerCase();
    const sf = filters.sessionIdFilter;
    if (!kf && !sf) return entries;
    return entries.filter((e) => {
      if (kf && !e.kind.toLowerCase().includes(kf)) return false;
      if (sf && e.sessionId !== sf) return false;
      return true;
    });
  }, [entries, filters]);

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, filtered.length]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(serialize()).catch(() => undefined);
  }, [serialize]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={t("diagnostics.title")}
      className="fixed right-0 top-0 z-[60] flex h-screen w-[480px] flex-col border-l border-hairline bg-canvas shadow-elevated"
    >
      <div className="flex h-[var(--panel-header-h)] flex-none items-center justify-between gap-[var(--space-sm)] border-b border-hairline-soft px-[var(--space-base)]">
        <div className="flex items-center gap-[var(--space-xs)] text-ui font-medium text-ink">
          <FileBadge size={14} strokeWidth={1.6} className="text-muted" />
          {t("diagnostics.title")}
          <span className="font-mono text-label text-muted-soft">{filtered.length}/{entries.length}</span>
        </div>
        <div className="flex items-center gap-[2px]">
          <IconButton size="md" onClick={clear} title={t("diagnostics.clear")} aria-label={t("diagnostics.clear")}>
            <Trash2 size={14} strokeWidth={1.6} />
          </IconButton>
          <IconButton
            size="md"
            onClick={handleCopy}
            title={t("diagnostics.copyToClipboard")}
            aria-label={t("diagnostics.copyToClipboard")}
          >
            <Copy size={14} strokeWidth={1.6} />
          </IconButton>
          <IconButton size="md" onClick={() => setOpen(false)} title={t("common.close")} aria-label={t("common.close")}>
            <X size={14} strokeWidth={1.6} />
          </IconButton>
        </div>
      </div>

      <div className="flex flex-none items-center gap-[var(--space-xs)] border-b border-hairline-soft px-[var(--space-base)] py-[var(--space-xs)]">
        <input
          type="text"
          value={filters.kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          placeholder={t("diagnostics.filterPlaceholder")}
          className="h-7 min-w-0 flex-1 rounded-sm border border-hairline bg-surface-card px-2 text-caption text-ink outline-none placeholder:text-muted-soft focus:border-hairline-strong"
        />
        {filters.sessionIdFilter ? (
          <button
            type="button"
            onClick={() => setSessionIdFilter(null)}
            className="flex h-7 items-center gap-1 rounded-sm border border-hairline px-2 font-mono text-label text-muted hover:border-hairline-strong hover:text-ink"
            title={filters.sessionIdFilter}
          >
            s:{filters.sessionIdFilter.slice(0, 6)}
            <X size={12} strokeWidth={1.6} />
          </button>
        ) : null}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center px-[var(--space-base)] text-center text-caption text-muted-soft">
            {t("diagnostics.empty")}
          </div>
        ) : (
          filtered.map((e) => (
            <DiagRow key={e.id} entry={e} onPickSession={setSessionIdFilter} />
          ))
        )}
      </div>
    </div>
  );
}
