import type { IconComponent } from "@/components/ui/icons";
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon?: IconComponent;
  /** Short headline. Rendered as Fraunces display — keep it 1 line. */
  title?: ReactNode;
  /** Supporting paragraph. */
  body?: ReactNode;
  /** Optional CTA row (buttons, links). */
  action?: ReactNode;
  /** `panel` wraps content in a surface-2 card with a hairline + shadow-elevated
   *  — for empty terminal/CLI tabs that fill the whole work area. `inline` skips
   *  the chrome and is intended for empty sub-regions inside an already-framed
   *  panel (source-control list, etc.). */
  variant?: "panel" | "inline";
  className?: string;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  variant = "inline",
  className,
}: EmptyStateProps) {
  const card = variant === "panel";
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col items-center justify-center text-center",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-col items-center gap-10px",
          card &&
            "max-w-[320px] rounded-md border border-hairline-soft bg-surface-card px-26px py-24px shadow-elevated",
        )}
      >
        {icon ? <Icon icon={icon} size={20} className="text-muted-soft" /> : null}
        {title ? (
          <p className="font-display text-title leading-[1.35] text-body">
            {title}
          </p>
        ) : null}
        {body ? (
          <p className="max-w-[260px] text-caption leading-[1.55] text-muted">
            {body}
          </p>
        ) : null}
        {action ? <div className="mt-4px">{action}</div> : null}
      </div>
    </div>
  );
}
