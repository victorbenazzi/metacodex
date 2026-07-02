import type { ReactNode } from "react";

import type { SelectOption } from "@/components/ui/Select";

/** Shared building blocks for the Settings dialog panes (promoted from SettingsDialog). */

export function PaneHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-[20px]">
      <h2 className="font-display text-display-s font-medium text-ink">
        {title}
      </h2>
      {description ? <p className="mt-[4px] text-ui text-muted">{description}</p> : null}
    </header>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-[20px] border-b border-hairline-soft py-[14px] last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium text-ink">{label}</div>
        {hint ? <div className="mt-[2px] text-caption text-muted">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Ensure the active value always has a matching option (e.g. hand-edited
 *  settings.json with a family not in our curated list). */
export function withCurrent(options: SelectOption[], value: string): SelectOption[] {
  return options.some((o) => o.value === value) ? options : [{ value, label: value }, ...options];
}
