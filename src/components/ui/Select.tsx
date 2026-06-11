import * as RS from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel: string;
  className?: string;
}

/**
 * Token-driven select built on Radix. Dropdown uses the shared opacity-only fade
 * (no slide/scale) and a token focus ring so the browser default never leaks.
 * Renders above the Settings dialog (z above the dialog content).
 */
export function Select({ value, onValueChange, options, ariaLabel, className }: SelectProps) {
  return (
    <RS.Root value={value} onValueChange={onValueChange}>
      <RS.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-[30px] min-w-[160px] items-center justify-between gap-[8px] rounded-sm",
          "border border-hairline-strong bg-canvas px-[10px] text-caption text-ink outline-none",
          "transition-colors hover:bg-surface-strong/45",
          "focus-visible:ring-2 focus-visible:ring-ink/25 data-[state=open]:border-ink",
          className,
        )}
      >
        <RS.Value />
        <RS.Icon asChild>
          <Icon icon={ChevronDown} size={13} className="text-muted" />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "z-[120] max-h-[280px] overflow-hidden rounded-md border border-hairline bg-surface-card p-[5px]",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        >
          <RS.Viewport className="min-w-[var(--radix-select-trigger-width)]">
            {options.map((opt) => (
              <RS.Item
                key={opt.value}
                value={opt.value}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-[12px] rounded-sm px-[10px] py-[7px]",
                  "text-caption text-ink outline-none data-[highlighted]:bg-surface-strong/70",
                )}
              >
                <RS.ItemText>{opt.label}</RS.ItemText>
                <RS.ItemIndicator>
                  <Icon icon={Check} size={12} className="text-ink" />
                </RS.ItemIndicator>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
