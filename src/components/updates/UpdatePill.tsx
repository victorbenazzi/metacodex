import { useTranslation } from "react-i18next";
import { Download, Loader2, RotateCcw } from "lucide-react";

import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/Icon";
import { useUpdatesStore } from "@/features/updates/updates.store";
import { startInstall } from "@/features/updates/updates.service";

/**
 * Top-bar pill announcing an available update. Self-hides when there's no
 * update to act on (status idle/checking) so the title bar's centered cluster
 * stays minimal during the common path.
 *
 * Click semantics: pressing the pill while `available` or `error` kicks off
 * `startInstall()` immediately — no confirmation dialog. During download/
 * install it becomes a read-only progress indicator.
 */
export function UpdatePill() {
  const { t } = useTranslation();
  const status = useUpdatesStore((s) => s.status);

  if (status.kind === "idle" || status.kind === "checking") return null;

  const isError = status.kind === "error";
  const isBusy =
    status.kind === "downloading" || status.kind === "installing";

  const colorClass = isError
    ? "border-[var(--warn)]/45 bg-[var(--warn)]/12 text-[var(--warn)] hover:bg-[var(--warn)]/18"
    : "border-[var(--update-blue)]/50 bg-[var(--update-blue)]/14 text-[var(--update-blue)] hover:bg-[var(--update-blue)]/20";

  let label: string;
  let LeftIcon = Download;
  let spinning = false;

  if (status.kind === "available") {
    label = t("updates.pill.available", { version: status.version });
    LeftIcon = Download;
  } else if (status.kind === "downloading") {
    const percent =
      status.total && status.total > 0
        ? Math.min(99, Math.floor((status.downloaded / status.total) * 100))
        : null;
    label = percent === null
      ? t("updates.pill.downloadingIndeterminate")
      : t("updates.pill.downloading", { percent });
    LeftIcon = Loader2;
    spinning = true;
  } else if (status.kind === "installing") {
    label = t("updates.pill.installing");
    LeftIcon = Loader2;
    spinning = true;
  } else {
    label = t("updates.pill.error");
    LeftIcon = RotateCcw;
  }

  const handleClick = () => {
    if (isBusy) return;
    void startInstall();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isBusy}
      title={label}
      className={cn(
        "inline-flex items-center gap-[6px] rounded-full border px-[10px] py-[2px]",
        "font-mono text-[11px] leading-none transition-colors duration-150",
        isBusy ? "cursor-default" : "cursor-pointer",
        colorClass,
      )}
    >
      <Icon
        icon={LeftIcon}
        size={10}
        strokeWidth={2}
        className={spinning ? "animate-spin" : undefined}
      />
      <span>{label}</span>
    </button>
  );
}
