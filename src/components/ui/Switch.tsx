import { cn } from "@/lib/cn";

/** Compact pill switch, visual style matches the rest of the settings dialog
 *  (no Radix dependency, no animation library; a plain accessible button).
 *  Promoted from SettingsDialog to the shared ui kit. */
export function Switch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-pill border transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
        checked
          ? "border-ink bg-ink"
          : "border-hairline-strong bg-surface-strong/40 hover:bg-surface-strong/60",
      )}
    >
      <span
        className={cn(
          "inline-block h-[12px] w-[12px] rounded-pill transition-transform",
          checked ? "translate-x-[16px] bg-on-primary" : "translate-x-[2px] bg-muted",
        )}
      />
    </button>
  );
}
