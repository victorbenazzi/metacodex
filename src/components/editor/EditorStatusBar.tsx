import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { useEditorStatusStore } from "@/features/editor/editor-status.store";

interface EditorStatusBarProps {
  tabId: string;
  language: string;
  encoding: string;
  eol: "LF" | "CRLF";
  sizeBytes: number;
}

/**
 * Bottom status strip for an editor buffer: language on the left, live cursor
 * position and file metadata on the right. The metrics group is right-aligned
 * (editor-toolbar convention) and uses tabular figures so the numbers don't
 * shift as the cursor moves.
 */
export function EditorStatusBar({
  tabId,
  language,
  encoding,
  eol,
  sizeBytes,
}: EditorStatusBarProps) {
  const { t } = useTranslation();
  const status = useEditorStatusStore((s) => s.byTab[tabId]);
  const line = status?.line ?? 1;
  const col = status?.col ?? 1;
  const selChars = status?.selChars ?? 0;
  const ranges = status?.ranges ?? 1;

  return (
    <div className="flex h-[22px] shrink-0 select-none items-center justify-between border-t border-hairline-soft bg-canvas px-12px text-label text-muted">
      <span className="truncate">{language}</span>
      <div className="flex shrink-0 items-center gap-8px font-mono tabular-nums">
        <span>{t("editor.lineCol", { line, col })}</span>
        {selChars > 0 ? (
          <>
            <Sep />
            <span>{t("editor.selChars", { count: selChars })}</span>
          </>
        ) : null}
        {ranges > 1 ? (
          <>
            <Sep />
            <span>{t("editor.cursors", { count: ranges })}</span>
          </>
        ) : null}
        <Sep />
        <span>{encodingLabel(encoding, t)}</span>
        <Sep />
        <span>{eol}</span>
        <Sep />
        <span>{formatBytes(sizeBytes)}</span>
      </div>
    </div>
  );
}

function Sep() {
  return <span className="text-muted-soft">·</span>;
}

function encodingLabel(encoding: string, t: TFunction): string {
  if (encoding === "utf-8") return "UTF-8";
  if (encoding === "lossy") return t("editor.lossy");
  return encoding.toUpperCase();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
