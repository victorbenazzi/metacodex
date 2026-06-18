import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

interface SidebarRowProps extends HTMLAttributes<HTMLDivElement> {
  active: boolean;
  leading: ReactNode;
  label: string;
  title?: string;
  onActivate: () => void;
  trailing?: ReactNode;
}

/**
 * Shared "project parent" bar for the Agent and Code sidebars: a hover-lit row
 * with a leading glyph, a truncating activate button, and a caller-supplied
 * trailing control cluster (chevron, "+", "⋯"). One token set across both views
 * is the point: it is what makes Agent and Code read as one surface. The bar is
 * all this owns; the caller wraps it (e.g. a context menu) and renders the
 * nested section (`SidebarNest`) itself, so trailing order stays caller-defined.
 *
 * Forwards its ref and spreads the rest of the props onto the root so it can be
 * a Radix `asChild` trigger (the Code row wraps it in a context menu).
 */
export const SidebarRow = forwardRef<HTMLDivElement, SidebarRowProps>(function SidebarRow(
  { active, leading, label, title, onActivate, trailing, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "group/proj flex w-full items-center gap-[8px] rounded-md px-[10px] py-[6px] text-ui transition-colors duration-fast",
        active ? "bg-surface-strong/45 text-ink" : "text-body hover:bg-surface-strong/30",
        className,
      )}
      {...rest}
    >
      {leading}
      <button
        type="button"
        onClick={onActivate}
        className="min-w-0 flex-1 truncate text-left outline-none"
        title={title}
      >
        {label}
      </button>
      {trailing}
    </div>
  );
});

/** Expand/collapse chevron for a SidebarRow's trailing slot. Visible when
 *  collapsed; hover-revealed (via the row's `group/proj`) when expanded. */
export function SidebarChevron({
  collapsed,
  onToggle,
  expandLabel,
  collapseLabel,
}: {
  collapsed: boolean;
  onToggle: () => void;
  expandLabel: string;
  collapseLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? expandLabel : collapseLabel}
      aria-expanded={!collapsed}
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm text-muted-soft transition-colors duration-fast hover:bg-surface-strong/55 hover:text-ink",
        collapsed ? "" : "opacity-0 transition-opacity focus-visible:opacity-100 group-hover/proj:opacity-100",
      )}
    >
      <Icon
        icon={ChevronDown}
        size={12}
        strokeWidth={2.25}
        className={cn("transition-transform duration-fast", collapsed && "-rotate-90")}
      />
    </button>
  );
}

/** The indented, hairline-ruled container for a SidebarRow's nested section. */
export function SidebarNest({ children }: { children: ReactNode }) {
  return (
    <div className="mb-[4px] ml-[16px] border-l border-hairline-soft pl-[6px]">{children}</div>
  );
}
