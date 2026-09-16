import { useTranslation } from "react-i18next";
import type { AccountUsage } from "@/features/usage/usage.types";

export function UsageAccountDetails({ account }: { account: AccountUsage }) {
  const { t, i18n } = useTranslation();
  const usd = new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  const number = new Intl.NumberFormat(i18n.language);
  const money = (value: number | null) => value == null ? t("usage.unknown") : usd.format(value);
  return <section className="mb-24px space-y-16px">
    <h3 className="text-ui font-medium">{t("usage.planConsumption")}</h3>
    <dl className="grid grid-cols-2 gap-16px text-caption">
      {([
        ["includedUsed", account.includedUsedUsd], ["includedLimit", account.includedLimitUsd],
        ["onDemandUsed", account.onDemandUsedUsd], ["onDemandLimit", account.onDemandLimitUsd],
      ] as const).map(([label, value]) => <div key={label} className="space-y-4px"><dt className="text-muted">{t(`usage.${label}`)}</dt><dd className="font-mono tabular-nums text-body">{money(value)}</dd></div>)}
    </dl>
    <h3 className="border-t border-hairline-soft pt-20px text-ui font-medium">{t("usage.accountHistory")}</h3>
    <p className="text-caption leading-relaxed text-muted">{t("usage.accountHistoryNote")}</p>
    {account.historyIssue ? <p role="status" className="text-caption text-warn">{t("usage.accountHistoryIncomplete")}</p> : account.historyStart == null ? <p className="text-caption text-muted">{t("usage.notObserved")}</p> : account.history.length === 0 ? <p className="text-caption text-muted">{t("usage.accountHistoryEmpty")}</p> : <div className="overflow-x-auto">
      <table className="w-full text-right text-caption">
        <thead className="text-muted"><tr>{["date", "requests", "tokens", "charged", "apiEquivalent"].map(key => <th key={key} scope="col" className="whitespace-nowrap border-b border-hairline-soft pb-10px pr-12px font-normal first:text-left last:pr-0">{t(`usage.${key}`)}</th>)}</tr></thead>
        <tbody>{account.history.map(day => <tr key={day.date} className="border-b border-hairline-soft">
          <td className="py-10px pr-12px text-left">{new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</td>
          <td className="pr-12px font-mono tabular-nums">{number.format(day.requests)}</td>
          <td className="pr-12px font-mono tabular-nums">{day.tokens != null && /^\d+$/.test(day.tokens) ? number.format(BigInt(day.tokens)) : t("usage.unknown")}</td>
          <td className="pr-12px font-mono tabular-nums">{money(day.chargedUsd)}</td>
          <td className="font-mono tabular-nums">{money(day.apiCostUsd)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
