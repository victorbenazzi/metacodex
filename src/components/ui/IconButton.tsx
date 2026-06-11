import { forwardRef } from "react";

import { cn } from "@/lib/cn";

type Size = "sm" | "md" | "lg";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size;
  /** Icon-only controls have no visible text, so the label is mandatory. */
  "aria-label": string;
}

const sizeClasses: Record<Size, string> = {
  sm: "h-[18px] w-[18px] rounded-xs", // inline row hover actions
  md: "h-[24px] w-[24px] rounded-xs", // dialog / panel chrome
  lg: "h-[28px] w-[28px] rounded-sm", // toolbars
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-muted transition-colors",
        "hover:bg-surface-strong/55 hover:text-ink",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "data-[state=open]:bg-surface-strong/55 data-[state=open]:text-ink",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
});
