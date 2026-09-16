import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "@/components/ui/Select";
import { historyInRange, sumTokens } from "@/features/usage/usage.format";
import type { DailyUsage } from "@/features/usage/usage.types";

export function UsageHistory({ days, now }: { days: DailyUsage[]; now: number }) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState("30");
  const filtered = useMemo(() => historyInRange(days, Number(range), now), [days, range, now]);
  const total = sumTokens(filtered);
  const max = filtered.reduce((value, day) => BigInt(day.tokens) > value ? BigInt(day.tokens) : value, 1n);
  const formatter = new Intl.NumberFormat(i18n.language);
  return <section className="space-y-14px border-t border-hairline-soft pt-20px">
    <div className="flex flex-wrap items-center justify-between gap-12px">
      <h3 className="text-ui font-medium">{t("usage.history")}</h3>
      <Select value={range} onValueChange={setRange} ariaLabel={t("usage.period")} options={[7, 30, 90].map(value => ({ value: String(value), label: t("usage.lastDays", { count: value }) }))} />
    </div>
    {filtered.length ? <>
      <p className="text-title font-medium tabular-nums">{formatter.format(total)} <span className="text-caption font-normal text-muted">{t("usage.tokensReported")}</span></p>
      <div className="flex h-[110px] items-end gap-[3px] border-b border-hairline-soft" role="img" aria-label={t("usage.historyChart", { total: formatter.format(total), count: filtered.length })}>
        {filtered.map(day => <div key={day.date} title={`${day.date}: ${formatter.format(BigInt(day.tokens))}`} className="min-w-0 flex-1 rounded-t-xs bg-ink/70" style={{ height: `${Math.max(1, Number(BigInt(day.tokens) * 10000n / max) / 100)}%` }} />)}
      </div>
      <div className="flex justify-between font-mono text-label text-muted"><span>{filtered[0].date}</span><span>{filtered[filtered.length - 1].date}</span></div>
      <p className="text-caption leading-relaxed text-muted">{t("usage.historyScope")}</p>
      <details className="text-caption"><summary className="cursor-pointer text-body focus-visible:outline-ink">{t("usage.dailyValues")}</summary>
        <table className="mt-10px w-full text-left">
          <thead>
            <tr className="border-b border-hairline-soft text-muted">
              <th className="py-6px font-normal">{t("usage.dateUtc")}</th>
              <th className="text-right font-normal">{t("usage.tokens")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(day => (
              <tr key={day.date} className="border-b border-hairline-soft">
                <td className="py-6px">{day.date}</td>
                <td className="text-right font-mono tabular-nums">{formatter.format(BigInt(day.tokens))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </> : <p className="py-16px text-caption text-muted">{t("usage.noHistory")}</p>}
  </section>;
}
