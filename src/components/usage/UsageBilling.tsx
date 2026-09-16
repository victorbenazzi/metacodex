import { useTranslation } from "react-i18next";
import type { BillingUsage } from "@/features/usage/usage.types";

export function UsageBilling({ billing }: { billing: BillingUsage }) {
  const { t, i18n } = useTranslation();
  const date = (value: number | null) => value == null ? t("usage.unknown") : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(value * 1000);
  return <section className="mb-20px space-y-12px rounded-md border border-hairline bg-canvas-soft p-16px">
    <h3 className="text-ui font-medium">{t("usage.accountBilling")}</h3>
    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-16px gap-y-10px text-caption">
      {([
        ["usagePeriodStart", billing.usagePeriodStart], ["usagePeriodEnd", billing.usagePeriodEnd],
        ["billingPeriodStart", billing.periodStart], ["billingPeriodEnd", billing.periodEnd],
      ] as const).map(([key, value]) => <div key={key} className="space-y-4px">
        <dt className="text-muted">{t(`usage.${key}`)}</dt><dd className="text-body">{date(value)}</dd>
      </div>)}
    </dl>
    <p className="text-caption leading-relaxed text-muted">{t("usage.accountBillingNote")}</p>
  </section>;
}
