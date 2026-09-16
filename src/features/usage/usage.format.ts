import type { ProviderUsage, QuotaWindow, DailyUsage } from "./usage.types";

export function isExpired(window: QuotaWindow, now: number): boolean {
  return window.resetsAt != null && window.resetsAt * 1000 <= now;
}
export function isStale(provider: ProviderUsage, now: number): boolean {
  // Recorded turns are historical facts; an idle Cursor session does not make
  // its last response out of date like an account quota reading.
  if (provider.id === "cursor-cli" && !provider.account) return provider.status === "error";
  return provider.observedAt != null && (provider.status === "error" || now - provider.observedAt * 1000 > 5 * 60_000);
}
export function quotaLabel(window: QuotaWindow, locale: string): string | null {
  const minutes = window.durationMinutes;
  if (minutes == null || minutes <= 0) return window.label;
  const unit = minutes % 1440 === 0 ? "day" : minutes % 60 === 0 ? "hour" : "minute";
  const amount = unit === "day" ? minutes / 1440 : unit === "hour" ? minutes / 60 : minutes;
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short" }).format(amount);
}
export function historyInRange(days: DailyUsage[], range: number, now: number): DailyUsage[] {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - range + 1);
  const start = cutoff.toISOString().slice(0, 10);
  const end = new Date(now).toISOString().slice(0, 10);
  return days.filter(day => day.date >= start && day.date <= end && /^\d+$/.test(day.tokens));
}
export function sumTokens(days: DailyUsage[]): bigint {
  return days.reduce((sum, day) => sum + BigInt(day.tokens), 0n);
}
