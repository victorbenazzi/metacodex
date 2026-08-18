import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import * as RD from "@radix-ui/react-dialog";
import { ChevronLeft } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

interface PaletteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  onBack?: () => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/**
 * Centered t3-code style picker: search field, list, keyboard footer.
 * Opacity-only open/close (no slide/scale). No backdrop blur.
 */
export function PaletteSheet({
  open,
  onOpenChange,
  title,
  placeholder,
  query,
  onQueryChange,
  onBack,
  onKeyDown,
  children,
  footer,
  width = 420,
}: PaletteSheetProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      const id = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
  }, [open]);

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay
          className={cn(
            "fixed inset-0 z-[100] overlay-scrim",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        <RD.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          style={{ width }}
          className={cn(
            "fixed left-1/2 top-[18vh] z-[101] flex max-h-[72vh] -translate-x-1/2 flex-col overflow-hidden",
            "rounded-lg border border-hairline surface-raised",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        >
          <RD.Title className="sr-only">{title}</RD.Title>
          <header className="flex shrink-0 items-center gap-8px border-b border-hairline-soft px-12px py-10px">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                aria-label={title}
                className="inline-flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-sm text-muted transition-colors duration-fast hover:bg-surface-strong/55 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
              >
                <Icon icon={ChevronLeft} size={14} />
              </button>
            ) : null}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onQueryChange(e.currentTarget.value)}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent text-ui text-ink outline-none placeholder:text-muted-soft"
            />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6px py-6px">{children}</div>
          {footer ? (
            <footer className="flex shrink-0 flex-wrap items-center gap-x-14px gap-y-6px border-t border-hairline-soft px-12px py-8px">
              {footer}
            </footer>
          ) : null}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function PaletteHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-6px text-label text-muted-soft">
      <span className="inline-flex items-center gap-[3px]">
        {keys.map((k) => (
          <kbd
            key={k}
            className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-hairline bg-canvas-soft px-5px font-mono text-micro leading-none text-muted"
          >
            {k}
          </kbd>
        ))}
      </span>
      {label}
    </span>
  );
}

export function PaletteSection({ label }: { label: string }) {
  return (
    <div className="px-10px pb-4px pt-8px text-label font-medium text-muted-soft">{label}</div>
  );
}

export function PaletteRow({
  active,
  icon,
  label,
  description,
  trailing,
  onHover,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  description?: string;
  trailing?: ReactNode;
  onHover: () => void;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onMouseMove={onHover}
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-10px rounded-sm px-10px py-8px text-left transition-colors duration-fast",
        active ? "bg-surface-strong/55" : "hover:bg-surface-strong/35",
      )}
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-ink">{label}</span>
        {description ? (
          <span className="mt-[1px] block truncate text-label text-muted-soft">{description}</span>
        ) : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
      <span className="sr-only">{t("v3.palette.selectHint")}</span>
    </button>
  );
}
