import * as RD from "@radix-ui/react-dialog";
import { X } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
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
  const { t } = useTranslation();
  return (
    <RD.Portal>
      <RD.Overlay
        className={cn(
          "fixed inset-0 z-[100] bg-scrim",
          "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
        )}
      />
      <RD.Content
        onCloseAutoFocus={onCloseAutoFocus}
        style={{ width }}
        className={cn(
          // max-h + column layout: the BODY scrolls while header/footer stay
          // pinned, so the action buttons never fall off a short viewport.
          "fixed left-1/2 top-1/2 z-[101] flex max-h-[85dvh] -translate-x-1/2 -translate-y-1/2 flex-col",
          "rounded-md border border-hairline bg-surface-card",
          "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
        )}
      >
        {title || description ? (
          <header className="shrink-0 border-b border-hairline-soft px-18px pb-12px pt-16px">
            {title ? (
              <RD.Title className="text-ui font-medium tracking-tight text-ink">
                {title}
              </RD.Title>
            ) : null}
            {description ? (
              <RD.Description className="mt-4px text-caption text-muted">
                {description}
              </RD.Description>
            ) : null}
          </header>
        ) : null}

        <div className="min-h-0 overflow-y-auto px-18px py-16px">{children}</div>

        {footer ? (
          <footer className="flex shrink-0 items-center justify-end gap-8px border-t border-hairline-soft px-18px py-12px">
            {footer}
          </footer>
        ) : null}

        <RD.Close asChild>
          <IconButton
            aria-label={t("common.closeDialog")}
            className="absolute right-[10px] top-[10px]"
          >
            <Icon icon={X} size={12} />
          </IconButton>
        </RD.Close>
      </RD.Content>
    </RD.Portal>
  );
}
