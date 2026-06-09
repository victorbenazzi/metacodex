import type { ReactNode } from "react";

/** Shared chrome for the Agent View Work panels: scroll container + centered
 *  column + Fraunces display header, matching the Settings pane rhythm. */
export function PanelShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-[28px] py-[28px]">
        <header className="mb-[20px]">
          <h1 className="font-display text-[24px] tracking-[-0.01em] text-ink">{title}</h1>
          {subtitle ? <p className="mt-[4px] text-[13px] text-muted">{subtitle}</p> : null}
        </header>
        {children}
      </div>
    </div>
  );
}
