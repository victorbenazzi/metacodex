import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";

export type LoadingStateVariant = "drive" | "dots" | "orbit";

interface LoadingStateProps {
  /** Visible label. Defaults to the i18n working string when not compact. */
  label?: string;
  variant?: LoadingStateVariant;
  /** Live elapsed timer in mono tabular figures. */
  showElapsed?: boolean;
  /** Grid only: for tight chrome (title bar). */
  compact?: boolean;
  className?: string;
}

const CHEVRON = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const ORBIT = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS: Record<
  LoadingStateVariant,
  { delays: (number | null)[]; dur: number; round: boolean }
> = {
  drive: { delays: CHEVRON, dur: 650, round: false },
  dots: { delays: CHEVRON, dur: 650, round: true },
  orbit: { delays: ORBIT, dur: 950, round: false },
};

function LoaderGrid({
  delays,
  dur,
  round,
}: {
  delays: (number | null)[];
  dur: number;
  round: boolean;
}) {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {delays.map((delay, index) => (
        <span
          key={index}
          className={cn(
            "h-[4px] w-[4px] bg-ink",
            round ? "rounded-pill" : "rounded-[1px]",
            delay === null ? "opacity-[0.07]" : "loading-pixel",
          )}
          style={
            delay === null
              ? undefined
              : ({
                  "--loading-pixel-dur": `${dur}ms`,
                  "--loading-pixel-delay": `${delay}ms`,
                } as CSSProperties)
          }
        />
      ))}
    </span>
  );
}

function useElapsed(active: boolean) {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    if (!active) return;
    setDs(0);
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, [active]);
  return ds / 10;
}

/**
 * Pixel-grid loader for long-running work (Beautiful UI Drive/Dots/Orbit).
 * Paired with a shimmering label and an optional elapsed timer. Reduced
 * motion freezes the grid; the timer still ticks.
 */
export function LoadingState({
  label,
  variant = "drive",
  showElapsed = false,
  compact = false,
  className,
}: LoadingStateProps) {
  const { t } = useTranslation();
  const elapsed = useElapsed(showElapsed && !compact);
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.drive;
  const resolvedLabel = label ?? t("common.loadingState.working");

  const elapsedLabel =
    elapsed < 60
      ? t("common.loadingState.elapsedShort", { time: elapsed.toFixed(1) })
      : t("common.loadingState.elapsedLong", {
          minutes: Math.floor(elapsed / 60),
          time: (elapsed % 60).toFixed(1),
        });

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("flex w-fit items-center gap-10px", className)}
    >
      <LoaderGrid delays={delays} dur={dur} round={round} />
      {compact ? (
        <span className="sr-only">{resolvedLabel}</span>
      ) : (
        <>
          <span className="loading-shimmer text-ui font-medium">{resolvedLabel}</span>
          {showElapsed ? (
            <span className="font-mono text-label tabular-nums text-muted">{elapsedLabel}</span>
          ) : null}
        </>
      )}
    </div>
  );
}
