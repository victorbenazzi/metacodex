import * as RT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RT.Provider delayDuration={200} skipDelayDuration={100}>
      {children}
    </RT.Provider>
  );
}

interface TooltipProps {
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  children: React.ReactNode;
  delayDuration?: number;
  shortcut?: React.ReactNode;
}

export function Tooltip({
  content,
  side = "right",
  align = "center",
  delayDuration,
  shortcut,
  children,
}: TooltipProps) {
  return (
    <RT.Root delayDuration={delayDuration}>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          className={cn(
            "z-50 rounded-sm border border-hairline bg-surface-card px-[8px] py-[5px]",
            "text-caption text-ink font-medium tracking-tight",
            "data-[state=delayed-open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        >
          <span className="flex items-center gap-[8px]">
            {content}
            {shortcut ? (
              <span className="ml-[2px] inline-flex items-center text-muted">{shortcut}</span>
            ) : null}
          </span>
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
