import * as RDM from "@radix-ui/react-dropdown-menu";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type React from "react";

export const DropdownRoot = RDM.Root;
export const DropdownTrigger = RDM.Trigger;
export const DropdownPortal = RDM.Portal;

export function DropdownContent({
  children,
  align = "start",
  sideOffset = 6,
  className,
}: {
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  className?: string;
}) {
  return (
    <RDM.Portal>
      <RDM.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[220px] rounded-md border border-hairline bg-surface-card p-[5px]",
          "text-[13px] text-ink",
          "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          className,
        )}
      >
        {children}
      </RDM.Content>
    </RDM.Portal>
  );
}

export function DropdownItem({
  children,
  onSelect,
  disabled,
  trailing,
  destructive,
  className,
  keepOpenOnSelect,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  trailing?: React.ReactNode;
  destructive?: boolean;
  className?: string;
  /** Stay open after selection — for in-menu toggles like collapsible headers. */
  keepOpenOnSelect?: boolean;
}) {
  return (
    <RDM.Item
      onSelect={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        if (keepOpenOnSelect) e.preventDefault();
        onSelect?.();
      }}
      disabled={disabled}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-[12px] rounded-sm px-[10px] py-[7px] outline-none",
        "data-[highlighted]:bg-surface-strong/70 data-[highlighted]:text-ink",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
        destructive && "text-danger data-[highlighted]:text-danger data-[highlighted]:bg-danger/10",
        className,
      )}
    >
      <span className="flex items-center gap-[10px] whitespace-nowrap">{children}</span>
      {trailing ? <span className="shrink-0 text-muted">{trailing}</span> : null}
    </RDM.Item>
  );
}

export const DropdownSub = RDM.Sub;

/** Submenu trigger row — DropdownItem chrome + a trailing chevron. */
export function DropdownSubTrigger({
  children,
  disabled,
  className,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <RDM.SubTrigger
      disabled={disabled}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-[12px] rounded-sm px-[10px] py-[7px] outline-none",
        "data-[highlighted]:bg-surface-strong/70 data-[highlighted]:text-ink",
        "data-[state=open]:bg-surface-strong/70 data-[state=open]:text-ink",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
        className,
      )}
    >
      <span className="flex items-center gap-[10px] whitespace-nowrap">{children}</span>
      <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-muted" />
    </RDM.SubTrigger>
  );
}

export function DropdownSubContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <RDM.Portal>
      <RDM.SubContent
        sideOffset={6}
        alignOffset={-5}
        className={cn(
          "z-50 min-w-[220px] rounded-md border border-hairline bg-surface-card p-[5px]",
          "text-[13px] text-ink",
          "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          className,
        )}
      >
        {children}
      </RDM.SubContent>
    </RDM.Portal>
  );
}

export function DropdownSeparator() {
  return <RDM.Separator className="my-[5px] h-px bg-hairline-soft" />;
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <RDM.Label className="whitespace-nowrap px-[10px] pb-[4px] pt-[6px] editorial-caps">
      {children}
    </RDM.Label>
  );
}
