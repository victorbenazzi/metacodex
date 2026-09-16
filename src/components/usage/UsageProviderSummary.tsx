import { useTranslation } from "react-i18next";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { isStale } from "@/features/usage/usage.format";
import { USAGE_PROVIDERS, type ProviderUsage } from "@/features/usage/usage.types";
import { UsageQuota } from "./UsageQuota";

export function UsageProviderSummary({ provider, now, compact = false, onSelect }: {
  provider: ProviderUsage; now: number; compact?: boolean; onSelect?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const meta = USAGE_PROVIDERS.find(p => p.id === provider.id)!;
  const Brand = CLI_BRAND_ICONS[provider.id];
  const stale = isStale(provider, now);
  const observed = provider.observedAt == null ? null : new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(provider.observedAt * 1000);
  const latestTurn = provider.turns[0];
  const counter = (value: string | null) => value != null && /^\d+$/.test(value) ? new Intl.NumberFormat(i18n.language).format(BigInt(value)) : t("usage.unknown");
  return (
    <div className={cn(compact ? "py-12px" : "py-18px")}>
      <div className="mb-10px flex items-center justify-between gap-8px">
        <Button variant="ghost" size="sm" onClick={onSelect} disabled={!onSelect} className="-ml-5px justify-start gap-8px px-5px font-medium disabled:opacity-100 disabled:cursor-default">
          {Brand && <Brand size={18} />}
          <span>{meta.name}</span>
        </Button>
        <span className={cn("text-label", stale ? "text-warn" : "text-muted")}>
          {stale ? t("usage.stale") : t(`usage.status.${provider.status}`)}
        </span>
      </div>
      {(provider.accountLabel || provider.plan) && <p className="mb-10px truncate text-label text-muted">{[provider.accountLabel, provider.plan].filter(Boolean).join(" · ")}</p>}
      {provider.windows.length ? (
        <div className="space-y-10px">
          {(compact ? provider.windows.slice(0, 2) : provider.windows).map(window => <UsageQuota key={window.id} window={window} now={now} />)}
          {compact && provider.windows.length > 2 && <p className="text-label text-muted">{t("usage.moreLimits", { count: provider.windows.length - 2 })}</p>}
        </div>
      ) : latestTurn && !provider.account ? <div className="space-y-4px text-caption leading-relaxed">
        <p className="text-body">{t("usage.latestTurn", { input: counter(latestTurn.inputTokens), output: counter(latestTurn.outputTokens) })}</p>
        {!compact && <p className="text-muted">{t("usage.localQuotaUnavailable")}</p>}
      </div> : <p className="text-caption leading-relaxed text-muted">{t(provider.billing ? "usage.accountNoQuota" : `usage.empty.${provider.status}`)}</p>}
      {!compact && provider.account && provider.issue && <p role="status" className="mt-10px text-caption text-warn">{t(`usage.accountIssue.${provider.issue}`, { defaultValue: t("usage.accountIssue.unavailable") })}</p>}
      {!compact && <p className="mt-10px text-label text-muted">
        {provider.id === "claude-code" && observed ? `${t("usage.latestSession")} · ` : ""}
        {observed ? t("usage.observedAt", { time: observed }) : t("usage.notObserved")}
      </p>}
    </div>
  );
}
