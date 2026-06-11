import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

interface ComposerControlProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  /** Leading accent dot (e.g. project color) shown instead of the icon. */
  dot?: string;
  /** Tone of the leading icon, `danger` signals a risk-bearing selection. */
  tone?: "default" | "danger";
}

/**
 * The shared trigger for the composer's dropdown controls (model, project,
 * permission). A restrained pill that firms its background on hover and pins its
 * border to ink while the menu is open (Radix passes `data-state`). The label
 * truncates so a long model id never blows out the toolbar; the chevron and
 * leading glyph never shrink. Built `forwardRef` so Radix `asChild` can own it.
 */
export const ComposerControl = forwardRef<HTMLButtonElement, ComposerControlProps>(
  ({ icon, label, dot, tone = "default", className, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex h-[30px] min-w-0 max-w-[190px] items-center gap-[6px] rounded-pill border px-[10px]",
        "text-[12px] leading-none outline-none transition-colors duration-150",
        "border-hairline text-body hover:bg-surface-strong/40",
        "data-[state=open]:border-ink data-[state=open]:bg-surface-strong/40",
        "focus-visible:ring-2 focus-visible:ring-ink/20",
        className,
      )}
      {...rest}
    >
      {dot ? (
        <span
          className="h-[8px] w-[8px] shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
        />
      ) : (
        <Icon
          icon={icon}
          size={14}
          strokeWidth={2}
          className={tone === "danger" ? "text-danger" : "text-muted"}
        />
      )}
      <span className="truncate">{label}</span>
      <Icon icon={ChevronDown} size={13} strokeWidth={2} className="shrink-0 text-muted-soft" />
    </button>
  ),
);

ComposerControl.displayName = "ComposerControl";
