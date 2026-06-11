import type { ReactNode } from "react";

/** Shared chrome for the Agent View Work panels: scroll container + centered
 *  column + Fraunces display header, matching the Settings pane rhythm. An
 *  optional `action` slot sits on the right of the header (e.g. a Create button). */
export function PanelShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-[28px] py-[28px]">
        <header className="mb-[20px] flex items-start justify-between gap-[16px]">
          <div className="min-w-0">
            <h1 className="font-display text-[24px] tracking-[-0.01em] text-ink">{title}</h1>
            {subtitle ? <p className="mt-[4px] text-ui text-muted">{subtitle}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
        {children}
      </div>
    </div>
  );
}

/** Header for a section living inside a tabbed page (e.g. the Customize tabs):
 *  same anatomy as the PanelShell header, one step down in scale. */
export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-[18px] flex items-start justify-between gap-[16px]">
      <div className="min-w-0">
        <h2 className="font-display text-[18px] tracking-[-0.01em] text-ink">{title}</h2>
        {subtitle ? <p className="mt-[4px] text-ui text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
