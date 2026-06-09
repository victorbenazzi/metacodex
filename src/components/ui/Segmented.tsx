import type { LucideIcon } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** `sm` fits the 36px titlebar; `md` is the default for in-page controls. */
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}

/**
 * Token-driven segmented control. The active segment lifts onto `surface-card`
 * with full-ink text; inactive segments stay muted and firm up on hover. Color
 * transitions are 150ms; no transforms (keeps it crisp in the titlebar and
 * consistent with the app's restrained motion language).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  const sm = size === "sm";
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-[2px] rounded-md border border-hairline-soft bg-surface-1 p-[2px]",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center justify-center gap-[5px] rounded-sm font-medium transition-colors duration-150",
              sm ? "h-[20px] px-[8px] text-[11px]" : "h-[26px] px-[11px] text-[12px]",
              active
                ? "bg-surface-card text-ink shadow-elevated"
                : "text-muted hover:text-body",
            )}
          >
            {opt.icon ? (
              <Icon icon={opt.icon} size={sm ? 12 : 14} strokeWidth={2} />
            ) : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
