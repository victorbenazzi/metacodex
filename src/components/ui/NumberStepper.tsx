import { useState, type ReactNode } from "react";
import { Minus, Plus } from "@/components/ui/icons";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  ariaLabel: string;
}

/**
 * Compact numeric stepper (−/+ buttons around a directly-editable field). The
 * field keeps a local draft while focused and commits on blur/Enter, so a user
 * can type a multi-digit value without it being clamped mid-edit. Buttons clamp
 * to [min, max] and disable at the bounds.
 */
export function NumberStepper({ value, onChange, min, max, step = 1, ariaLabel }: NumberStepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const set = (n: number) => onChange(clamp(n));

  const commit = () => {
    if (draft == null) return;
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n)) set(n);
    setDraft(null);
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex h-[30px] items-center overflow-hidden rounded-sm border border-hairline-strong bg-canvas"
    >
      <StepBtn onClick={() => set(value - step)} disabled={value <= min} label={`${ariaLabel} −`}>
        <Icon icon={Minus} size={12} />
      </StepBtn>
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d-]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "h-full w-[56px] border-x border-hairline-strong bg-transparent text-center",
          "font-mono text-caption tabular-nums text-ink outline-none",
          "focus-visible:bg-surface-strong/30",
        )}
      />
      <StepBtn onClick={() => set(value + step)} disabled={value >= max} label={`${ariaLabel} +`}>
        <Icon icon={Plus} size={12} />
      </StepBtn>
    </div>
  );
}

function StepBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "inline-flex h-full w-[28px] items-center justify-center text-muted outline-none transition-colors",
        "hover:bg-surface-strong/45 hover:text-ink focus-visible:bg-surface-strong/45",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}
