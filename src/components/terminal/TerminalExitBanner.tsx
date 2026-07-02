import { useTranslation } from "react-i18next";
import { X, AlertTriangle } from "lucide-react";

import { IconButton } from "@/components/ui/IconButton";
import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";
import type { PtyExitReason } from "@/lib/events";

interface TerminalExitBannerProps {
  exitCode: number;
  reason: PtyExitReason;
  sessionId: string | null;
  onDismiss: () => void;
}

/** Sticky banner shown when a PTY exits with code !== 0 OR with a non-normal
 *  reason. Surfaces the why ("reader_error" → I/O died under us) and a link
 *  into the Diagnostic Log filtered to this session. */
export function TerminalExitBanner({ exitCode, reason, sessionId, onDismiss }: TerminalExitBannerProps) {
  const { t } = useTranslation();
  const setOpen = useDiagnosticsStore((s) => s.setOpen);
  const setSessionIdFilter = useDiagnosticsStore((s) => s.setSessionIdFilter);

  const messageKey =
    reason === "reader_error"
      ? "terminal.exitBanner.readerError"
      : reason === "killed"
        ? "terminal.exitBanner.killed"
        : "terminal.exitBanner.nonzero";

  const handleOpenLog = () => {
    if (sessionId) setSessionIdFilter(sessionId);
    setOpen(true);
  };

  return (
    <div
      role="status"
      className="flex flex-none items-start gap-[var(--space-xs)] border-b border-hairline bg-danger/[0.06] px-[var(--space-base)] py-[8px] text-caption text-ink"
    >
      <AlertTriangle size={14} className="mt-[2px] flex-none text-danger" />
      <div className="flex-1 leading-[1.5]">
        {t(messageKey, { code: exitCode })}
        <button
          type="button"
          onClick={handleOpenLog}
          className="ml-2 underline-offset-2 hover:underline"
        >
          {t("terminal.exitBanner.openLog")}
        </button>
      </div>
      <IconButton
        size="sm"
        onClick={onDismiss}
        title={t("common.dismiss")}
        aria-label={t("common.dismiss")}
        className="ml-1 flex-none"
      >
        <X size={12} />
      </IconButton>
    </div>
  );
}
