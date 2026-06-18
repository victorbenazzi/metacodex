/** Time formatting helpers shared across the UI. */

/**
 * Compact, non-localized relative age from an ISO timestamp: "5s", "3m", "2h",
 * "4d", "2w". Returns "" for an unparseable value. Used on dense list rows
 * (resume cards, Code sidebar history) where a fixed-width latin suffix reads
 * cleaner than a localized phrase. For the localized Agent-thread variant
 * ("agora", "5min") see `agoShort` in `SidebarThreads.tsx`.
 */
export function agoShort(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "";
  const s = Math.max(1, Math.floor((Date.now() - parsed) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}
