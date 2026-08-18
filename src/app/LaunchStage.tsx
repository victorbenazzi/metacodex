import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { IconComponent } from "@/components/ui/icons";
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/cn";

const chipClass =
  "inline-flex h-[32px] items-center gap-8px rounded-md border border-hairline bg-canvas-soft pl-10px pr-12px text-ui font-medium leading-none text-ink transition-colors duration-fast hover:bg-surface-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]";

function Rise({ delay, className, children }: { delay: number; className?: string; children: ReactNode }) {
  const style: CSSProperties = { animationDelay: `${delay}ms` };
  return (
    <div className={cn("animate-rise-in motion-reduce:animate-none", className)} style={style}>
      {children}
    </div>
  );
}

interface LaunchChipProps {
  icon?: IconComponent;
  brand?: ReactNode;
  label: string;
  onClick: () => void;
}

export function LaunchChip({ icon, brand, label, onClick }: LaunchChipProps) {
  return (
    <button type="button" onClick={onClick} className={chipClass}>
      <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center">
        {brand ?? (icon ? <Icon icon={icon} size={15} /> : null)}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

interface LaunchStageProps {
  glyph: ReactNode;
  title: string;
  meta?: string;
  resume?: ReactNode;
  chips: ReactNode;
}

/** Shared empty-stage chrome: centered identity, optional resume, action pills, shortcuts. */
export function LaunchStage({ glyph, title, meta, resume, chips }: LaunchStageProps) {
  const { t } = useTranslation();

  return (
    <div className="relative h-full w-full overflow-y-auto bg-canvas">
      <div aria-hidden className="dot-grid pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex min-h-full w-full flex-col items-center px-40px">
        <div className="my-auto flex w-full max-w-[640px] flex-col items-center py-40px">
          <Rise delay={40} className="flex flex-col items-center text-center">
            <span
              aria-hidden
              className="mb-18px flex h-[64px] w-[64px] items-center justify-center rounded-xl border border-hairline bg-canvas-soft"
            >
              {glyph}
            </span>

            <h1 className="max-w-full break-words font-display text-display font-medium leading-[1.1] text-ink">
              {title}
            </h1>

            {meta ? (
              <span
                className="mt-12px inline-flex max-w-full items-center rounded-md border border-hairline bg-canvas-soft px-10px py-4px font-mono text-label text-muted"
                title={meta}
              >
                <span className="truncate">{meta}</span>
              </span>
            ) : null}
          </Rise>

          {resume ? (
            <Rise delay={100} className="mt-32px w-full max-w-[560px] empty:mt-0">
              {resume}
            </Rise>
          ) : null}

          <Rise delay={160} className="mt-32px flex w-full flex-wrap justify-center gap-8px">
            {chips}
          </Rise>

          <Rise
            delay={220}
            className="mt-56px flex flex-wrap items-center justify-center gap-x-22px gap-y-8px font-mono text-label text-muted-soft"
          >
            <span className="inline-flex items-center gap-7px">
              <Kbd keys={["Mod", "Shift", "P"]} />
              {t("projectEmpty.hintCommands")}
            </span>
            <span className="inline-flex items-center gap-7px">
              <Kbd keys={["Mod", "P"]} />
              {t("projectEmpty.hintFiles")}
            </span>
            <span className="inline-flex items-center gap-7px">
              <Kbd keys={["Mod", "T"]} />
              {t("projectEmpty.hintTerminal")}
            </span>
          </Rise>
        </div>
      </div>
    </div>
  );
}
