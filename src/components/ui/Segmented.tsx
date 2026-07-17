import type { IconComponent } from "@/components/ui/icons";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/** Option shape consumed by the Segmented control. */
export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: IconComponent;
}

/** Inline segmented button group (matches the theme/language pickers).
 *  Promoted from SettingsDialog; this is the canonical segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-6px">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-[30px] items-center gap-6px rounded-sm border px-10px text-caption transition-colors",
              active
                ? "border-ink bg-ink text-on-primary"
                : "border-hairline-strong text-ink hover:bg-surface-strong/45",
            )}
          >
            {opt.icon ? (
              <Icon icon={opt.icon} size={12} className={active ? "text-on-primary" : ""} />
            ) : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
