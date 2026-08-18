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
  // Strokes render at strokeWidth * size / 24. Hugeicons is drawn for 1.5 at
  // 24px; chrome sizes (12-16) wash out unless we lift the stroke. Tiny glyphs
  // stay at 2. `block` on the SVG kills the inline baseline gap that made
  // icons sit off-center next to labels.
  const stroke = strokeWidth ?? (size <= 11 ? 2 : size <= 16 ? 1.75 : 1.5);
  return (
    <span
      ref={ref}
      className={cn("inline-flex shrink-0 items-center justify-center text-current", className)}
      {...props}
    >
      <I size={size} strokeWidth={stroke} aria-hidden className="block" />
    </span>
  );
});
