import { forwardRef } from "react";
import type { IconComponent } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  icon: IconComponent;
  size?: number;
  strokeWidth?: number;
}

export const Icon = forwardRef<HTMLSpanElement, IconProps>(function Icon(
  { icon: I, size = 16, strokeWidth, className, ...props },
  ref,
) {
  // Strokes render at strokeWidth * size / 24: Hugeicons stroke-rounded is
  // drawn for 1.5, but at micro sizes that washes out (~0.67px at 10px), so
  // tiny glyphs get 2 by rule instead of per-call overrides.
  const stroke = strokeWidth ?? (size <= 11 ? 2 : 1.5);
  return (
    <span
      ref={ref}
      className={cn("inline-flex items-center justify-center text-current", className)}
      {...props}
    >
      <I size={size} strokeWidth={stroke} aria-hidden />
    </span>
  );
});
