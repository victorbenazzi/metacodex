import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export const DialogRoot = RD.Root;
export const DialogTrigger = RD.Trigger;

interface DialogContentProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  onCloseAutoFocus?: (e: Event) => void;
}

export function DialogContent({
  title,
  description,
  children,
  footer,
  width = 380,
  onCloseAutoFocus,
}: DialogContentProps) {
  return (
    <RD.Portal>
      <RD.Overlay
        className={cn(
          "fixed inset-0 z-[100] bg-[rgba(38,37,30,0.32)] backdrop-blur-[2px]",
          "data-[state=open]:animate-fade-in",
        )}
      />
      <RD.Content
        onCloseAutoFocus={onCloseAutoFocus}
        style={{ width }}
        className={cn(
          "fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2",
          "rounded-md border border-hairline bg-surface-card",
          "data-[state=open]:animate-slide-up",
        )}
      >
        {title || description ? (
          <header className="border-b border-hairline-soft px-[18px] pb-[12px] pt-[16px]">
            {title ? (
              <RD.Title className="text-[13px] font-medium tracking-tight text-ink">
                {title}
              </RD.Title>
            ) : null}
            {description ? (
              <RD.Description className="mt-[4px] text-[12px] text-muted">
                {description}
              </RD.Description>
            ) : null}
          </header>
        ) : null}

        <div className="px-[18px] py-[16px]">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-[8px] border-t border-hairline-soft px-[18px] py-[12px]">
            {footer}
          </footer>
        ) : null}

        <RD.Close asChild>
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute right-[10px] top-[10px] inline-flex h-[22px] w-[22px] items-center justify-center rounded-xs text-muted hover:bg-surface-strong/55 hover:text-ink"
          >
            <Icon icon={X} size={12} />
          </button>
        </RD.Close>
      </RD.Content>
    </RD.Portal>
  );
}
