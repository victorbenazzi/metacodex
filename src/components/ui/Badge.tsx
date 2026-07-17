import { cn } from "@/lib/cn";

type Tone = "neutral" | "danger" | "warn" | "success" | "muted";

const toneClasses: Record<Tone, string> = {
  neutral: "border-hairline-strong text-ink",
  danger: "border-danger/30 text-danger bg-danger/[0.06]",
  warn: "border-warn/30 text-warn bg-warn/[0.07]",
  success: "border-success/30 text-success bg-success/[0.06]",
  muted: "border-hairline text-muted",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-4px rounded-xs border px-6px py-[1px] font-mono text-micro uppercase tracking-label",
        toneClasses[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
