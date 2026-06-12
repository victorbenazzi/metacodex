import type { LucideIcon } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export interface LateralTabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

/**
 * Sticky lateral tab rail shared by the Customize page and the agent profile
 * (same anatomy as the Settings dialog navigation): a `<nav>` of buttons with
 * `aria-current="page"` on the active one. Pass the rail width through
 * `className` (e.g. `w-[176px]`).
 */
export function LateralTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  tabs: LateralTabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name of the nav landmark. */
  ariaLabel: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn("sticky top-0 flex shrink-0 flex-col gap-[1px]", className)}
    >
      {tabs.map(({ id, label, icon }) => (
        <button
          key={id}
          type="button"
          aria-current={value === id ? "page" : undefined}
          onClick={() => onChange(id)}
          className={cn(
            "flex w-full items-center gap-[10px] rounded-md px-[10px] py-[7px] text-ui transition-colors duration-fast",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
            value === id ? "bg-surface-2 text-ink" : "text-body hover:bg-surface-1",
          )}
        >
          {icon ? (
            <Icon
              icon={icon}
              size={15}
              strokeWidth={1.75}
              className={value === id ? "text-ink" : "text-muted"}
            />
          ) : null}
          <span className="truncate text-left">{label}</span>
        </button>
      ))}
    </nav>
  );
}
