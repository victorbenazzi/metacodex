import * as RCM from "@radix-ui/react-context-menu";
import { cn } from "@/lib/cn";

export const ContextMenuRoot = RCM.Root;
export const ContextMenuTrigger = RCM.Trigger;

export function ContextMenuContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <RCM.Portal>
      <RCM.Content
        className={cn(
          "z-50 min-w-[200px] rounded-md border border-hairline bg-surface-card p-[5px] text-[13px] text-ink",
          // Tight floating elevation — Linear/Raycast aesthetic, denser than
          // Tailwind's shadow-lg. Layered to read at any background luminance.
          "shadow-[0_12px_30px_-12px_rgba(15,14,11,0.28),0_2px_4px_-2px_rgba(15,14,11,0.08)]",
          "dark:shadow-[0_14px_36px_-12px_rgba(0,0,0,0.7),0_2px_6px_-2px_rgba(0,0,0,0.4)]",
          "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          className,
        )}
      >
        {children}
      </RCM.Content>
    </RCM.Portal>
  );
}

export function ContextMenuItem({
  children,
  onSelect,
  destructive,
  trailing,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  destructive?: boolean;
  trailing?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <RCM.Item
      disabled={disabled}
      onSelect={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onSelect?.();
      }}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-[12px] rounded-sm px-[10px] py-[6px] outline-none",
        "data-[highlighted]:bg-surface-strong/70 data-[highlighted]:text-ink",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
        destructive && "text-danger data-[highlighted]:text-danger data-[highlighted]:bg-danger/10",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-[10px]">{children}</span>
      {trailing ? <span className="shrink-0 text-muted">{trailing}</span> : null}
    </RCM.Item>
  );
}

export function ContextMenuSeparator() {
  return <RCM.Separator className="my-[5px] h-px bg-hairline-soft" />;
}

export function ContextMenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <RCM.Label className="px-[10px] pb-[4px] pt-[6px] editorial-caps">{children}</RCM.Label>
  );
}

export function ContextMenuSub({
  trigger,
  children,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <RCM.Sub>
      <RCM.SubTrigger
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-[12px] rounded-sm px-[10px] py-[6px] outline-none",
          "data-[highlighted]:bg-surface-strong/70 data-[state=open]:bg-surface-strong/70 data-[highlighted]:text-ink",
        )}
      >
        <span className="flex min-w-0 items-center gap-[10px]">{trigger}</span>
        <span className="text-muted">›</span>
      </RCM.SubTrigger>
      <RCM.Portal>
        <RCM.SubContent
          className={cn(
            "z-50 min-w-[180px] rounded-md border border-hairline bg-surface-card p-[5px] text-[13px] text-ink",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        >
          {children}
        </RCM.SubContent>
      </RCM.Portal>
    </RCM.Sub>
  );
}
