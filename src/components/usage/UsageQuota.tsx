import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { isExpired, quotaLabel } from "@/features/usage/usage.format";
import type { QuotaWindow } from "@/features/usage/usage.types";

export function UsageQuota({ window, now }: { window: QuotaWindow; now: number }) {
  const { t, i18n } = useTranslation();
  const expired = isExpired(window, now);
  const label = ["cursor_plan", "cursor_auto", "cursor_api", "grok_credits"].includes(window.id) ? t(`usage.window.${window.id}`) : quotaLabel(window, i18n.language) ?? t(window.id === "spend_limit" ? "usage.spendLimit" : "usage.quotaWindow");
  const percent = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(window.usedPercent);
  const minutes = window.resetsAt == null ? null : Math.max(1, Math.ceil((window.resetsAt * 1000 - now) / 60_000));
  const unit = minutes != null && minutes >= 1440 ? "day" : minutes != null && minutes >= 60 ? "hour" : "minute";
  const amount = minutes == null ? 0 : Math.ceil(minutes / (unit === "day" ? 1440 : unit === "hour" ? 60 : 1));
  const relative = new Intl.RelativeTimeFormat(i18n.language, { style: "short" }).format(amount, unit);
  const exact = window.resetsAt == null ? undefined : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(window.resetsAt * 1000);
  return (
    <div className="space-y-5px">
      <div className="flex items-baseline justify-between gap-12px text-caption">
        <span className="min-w-0 truncate text-body">{label}{window.label && window.label !== label ? ` · ${window.label}` : ""}</span>
        <span className={cn("shrink-0 font-mono tabular-nums", expired ? "text-muted" : window.usedPercent >= 95 ? "text-danger" : "text-ink")}>
          {expired ? t("usage.renewing") : t("usage.usedPercent", { percent })}
        </span>
      </div>
      <div
        role={expired ? undefined : "progressbar"}
        aria-label={label}
        aria-valuemin={expired ? undefined : 0}
        aria-valuemax={expired ? undefined : 100}
        aria-valuenow={expired ? undefined : Math.min(100, Math.max(0, window.usedPercent))}
        aria-valuetext={expired ? undefined : t("usage.usedPercent", { percent })}
        className="h-[4px] overflow-hidden rounded-pill bg-surface-strong"
      >
        {!expired && <span className={cn("block h-full rounded-pill", window.usedPercent >= 95 ? "bg-danger" : window.usedPercent >= 80 ? "bg-warn" : "bg-ink")} style={{ width: `${Math.min(100, Math.max(0, window.usedPercent))}%` }} />}
      </div>
      <p className="text-label text-muted" title={exact}>
        {expired ? t("usage.waitingReset") : minutes == null ? t("usage.resetUnknown") : t("usage.resets", { time: relative })}
      </p>
    </div>
  );
}
