import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Tiny pulsing status dot after the label (e.g. "agent busy elsewhere").
   *  Same visual language as the tab status dot's `working` state. */
  dot?: boolean;
  /** Accessible name for the dot; without it the dot is decorative-only. */
  dotLabel?: string;
}

interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** `sm` fits the 36px titlebar; `md` is the default for in-page controls. */
  size?: "sm" | "md";
  /** `pill` is the high-presence treatment (titlebar view switch): fully
   *  rounded with a sliding thumb behind the active segment. `default` keeps
   *  the quiet in-page look where the active segment lifts in place. */
  variant?: "default" | "pill";
  ariaLabel?: string;
  className?: string;
}

/**
 * Token-driven segmented control. In the default variant the active segment
 * lifts onto `surface-card` with full-ink text; inactive segments stay muted
 * and firm up on hover. The pill variant adds a thumb that SLIDES between
 * segments (180ms ease-out, left/width on an absolutely-positioned layer, so
 * siblings never reflow; honors prefers-reduced-motion). Color transitions
 * stay 150ms.
 *
 * Radiogroup semantics for real: a single tab stop (the checked segment) with
 * roving focus, ArrowLeft/Right cycling and Home/End jumping, per the WAI-ARIA
 * radio-group pattern.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  variant = "default",
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  const sm = size === "sm";
  const pill = variant === "pill";
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  // Thumb geometry comes from the live DOM (labels are i18n'd, widths vary).
  // Kept in a ref so the ResizeObserver always measures against the current
  // value/options without re-subscribing.
  const measure = () => {
    const i = options.findIndex((o) => o.value === value);
    const btn = buttonsRef.current[i];
    if (!btn) return;
    setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
  };
  const measureRef = useRef(measure);
  measureRef.current = measure;

  useLayoutEffect(() => {
    if (pill) measureRef.current();
  }, [pill, value, options]);

  useEffect(() => {
    if (!pill) return;
    const box = containerRef.current;
    if (!box) return;
    // Catches width changes the value effect can't see: locale switch, font
    // load, a status dot appearing on a segment.
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(box);
    return () => ro.disconnect();
  }, [pill]);

  const moveTo = (index: number) => {
    const opt = options[index];
    if (!opt) return;
    onChange(opt.value);
    buttonsRef.current[index]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const current = options.findIndex((o) => o.value === value);
    if (current === -1) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      moveTo((current + 1) % options.length);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      moveTo((current - 1 + options.length) % options.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveTo(options.length - 1);
    }
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "relative inline-flex items-center gap-[2px] border border-hairline-soft bg-surface-1",
        pill ? "rounded-pill p-[3px]" : "rounded-md p-[2px]",
        className,
      )}
    >
      {pill && thumb ? (
        <span
          aria-hidden
          className="absolute bottom-[3px] top-[3px] rounded-pill border border-hairline-soft bg-surface-card shadow-elevated transition-[left,width] duration-[180ms] ease-out motion-reduce:transition-none"
          style={{ left: thumb.left, width: thumb.width }}
        />
      ) : null}
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              buttonsRef.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative inline-flex items-center justify-center gap-[5px] font-medium transition-colors duration-150",
              pill
                ? cn("rounded-pill", sm ? "h-[20px] px-[10px] text-[12px]" : "h-[26px] px-[12px] text-[12px]")
                : cn("rounded-sm", sm ? "h-[20px] px-[8px] text-[11px]" : "h-[26px] px-[11px] text-[12px]"),
              active
                ? pill
                  ? "text-ink"
                  : "bg-surface-card text-ink shadow-elevated"
                : "text-muted hover:text-body",
            )}
          >
            {opt.icon ? (
              <Icon icon={opt.icon} size={pill ? (sm ? 13 : 14) : sm ? 12 : 14} strokeWidth={2} />
            ) : null}
            {opt.label}
            {opt.dot ? (
              <span
                aria-label={opt.dotLabel}
                aria-live="polite"
                className="ml-[1px] inline-block h-[5px] w-[5px] shrink-0 rounded-full bg-muted animate-tab-status-pulse"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
