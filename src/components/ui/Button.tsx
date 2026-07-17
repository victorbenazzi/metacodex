import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "outline" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "press-feedback bg-ink text-on-primary hover:bg-primary-active focus-visible:outline-ink",
  ghost:
    "bg-transparent text-ink hover:bg-surface-strong/60 focus-visible:outline-ink",
  outline:
    "bg-transparent text-ink border border-hairline-strong hover:bg-surface-strong/40",
  subtle:
    "bg-surface-strong/40 text-ink hover:bg-surface-strong/70",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-[26px] px-10px text-caption rounded-sm",
  md: "h-[32px] px-14px text-ui rounded-sm",
  lg: "h-[40px] px-18px text-title rounded-md",
  icon: "h-[28px] w-[28px] rounded-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "ghost", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-6px font-medium tracking-tight transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed select-none",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
});
