import { useTranslation } from "react-i18next";

import { LoadingState } from "@/components/ui/LoadingState";
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
        "absolute inset-0 z-10 flex items-center justify-center bg-canvas/90",
        "animate-fade-in motion-reduce:animate-none",
        className,
      )}
    >
      <LoadingState label={title} showElapsed />
    </div>
  );
}
