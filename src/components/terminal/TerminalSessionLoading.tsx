import { useTranslation } from "react-i18next";
import { SquareTerminal } from "@/components/ui/icons";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

interface TerminalSessionLoadingProps {
  /** Process label (CLI name or terminal title). */
  label?: string;
  /** detecting = CLI binary probe; starting = PTY spawn. */
  phase?: "detecting" | "starting";
  className?: string;
}

/**
 * Soft loading surface while a Process tab is detecting a CLI or spawning a PTY.
 * Sits over the (possibly empty) terminal canvas so the first paint is never blank.
 */
export function TerminalSessionLoading({
  label,
  phase = "starting",
  className,
}: TerminalSessionLoadingProps) {
  const { t } = useTranslation();
  const title =
    phase === "detecting"
      ? t("terminal.detecting", { label: label ?? t("terminal.sessionFallback") })
      : label
        ? t("terminal.startingNamed", { label })
        : t("terminal.starting");

  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-canvas/90",
        "animate-fade-in motion-reduce:animate-none",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="relative flex h-12 w-12 items-center justify-center">
        {/* Outer ring */}
        <span
          className={cn(
            "absolute inset-0 rounded-pill border-2 border-hairline-soft",
            "border-t-accent border-r-accent/40",
            "animate-spin motion-reduce:animate-none",
          )}
          style={{ animationDuration: "0.9s" }}
          aria-hidden
        />
        {/* Soft pulse halo */}
        <span
          className="absolute inset-1 rounded-pill bg-accent/10 animate-pulse motion-reduce:animate-none"
          aria-hidden
        />
        <Icon icon={SquareTerminal} size={18} className="relative text-accent" />
      </div>

      <div className="flex flex-col items-center gap-1.5 px-6 text-center">
        <p className="text-ui text-ink">{title}</p>
        <div className="flex items-center gap-1" aria-hidden>
          <span className="h-1 w-1 rounded-pill bg-muted-soft animate-bounce motion-reduce:animate-none [animation-delay:0ms]" />
          <span className="h-1 w-1 rounded-pill bg-muted-soft animate-bounce motion-reduce:animate-none [animation-delay:120ms]" />
          <span className="h-1 w-1 rounded-pill bg-muted-soft animate-bounce motion-reduce:animate-none [animation-delay:240ms]" />
        </div>
      </div>
    </div>
  );
}
