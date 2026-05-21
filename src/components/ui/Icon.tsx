import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  icon: LucideIcon;
  size?: number;
  strokeWidth?: number;
}

export const Icon = forwardRef<HTMLSpanElement, IconProps>(function Icon(
  { icon: I, size = 16, strokeWidth = 1.6, className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn("inline-flex items-center justify-center text-current", className)}
      {...props}
    >
      <I size={size} strokeWidth={strokeWidth} aria-hidden />
    </span>
  );
});
