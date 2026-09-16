import { useEffect, useRef, useState } from "react";
import { autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, safePolygon, shift, useDismiss, useFloating, useFocus, useHover, useInteractions, useRole } from "@floating-ui/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Gauge, ArrowUpRight } from "@/components/ui/icons";
import { useChromeOverlayOpen, useOverlayLock } from "@/features/ui/overlayLock.store";
import { useUsageUiStore } from "@/features/usage/usage.ui.store";
import { useUsageView } from "@/features/usage/useUsageView";
import { isExpired, isStale } from "@/features/usage/usage.format";
import type { UsageProviderId } from "@/features/usage/usage.types";
import { UsageProviderSummary } from "./UsageProviderSummary";

export function UsageSidebarItem() {
  const { t } = useTranslation();
  const [hoverOpen, setHoverOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const lockId = useOverlayLock(hoverOpen);
  const blocked = useChromeOverlayOpen(lockId);
  const show = useUsageUiStore(s => s.show);
  const open = hoverOpen && !blocked;
  const { snapshot, refreshing, error, now } = useUsageView(open);
  useEffect(() => { if (blocked) setHoverOpen(false); }, [blocked]);
  const { refs, floatingStyles, context } = useFloating({
    open, onOpenChange: setHoverOpen, placement: "right-end", strategy: "fixed", transform: false,
    middleware: [offset(10), flip({ padding: 8 }), shift({ padding: 8 })], whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { enabled: !blocked, delay: { open: 250, close: 140 }, mouseOnly: true, handleClose: safePolygon() });
  const focus = useFocus(context, { enabled: !blocked });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  const openDetails = (provider?: UsageProviderId) => {
    setHoverOpen(false);
    show(provider, trigger.current);
  };
  const warning = snapshot.providers.some(provider => !isStale(provider, now) && provider.windows.some(w => !isExpired(w, now) && w.usedPercent >= 80));
  return <>
    <Button
      id="usage-sidebar-trigger"
      ref={node => { trigger.current = node; refs.setReference(node); }}
      variant="ghost" className="w-full justify-start gap-8px px-8px font-normal"
      {...getReferenceProps({ onClick: () => openDetails(), "aria-label": t("usage.title") })}
    >
      <Icon icon={Gauge} size={15} /><span className="flex-1 text-left">{t("usage.nav")}</span>
      {warning && <span className="h-[5px] w-[5px] rounded-pill bg-warn" aria-label={t("usage.nearLimit")} />}
    </Button>
    {open && <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus={false}>
        <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps({ "aria-label": t("usage.summary") })}
          className="z-[90] flex max-h-[min(660px,calc(100dvh-16px))] w-[340px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-lg border border-hairline bg-surface-card shadow-lg animate-fade-in">
          <header className="flex shrink-0 items-center justify-between border-b border-hairline-soft px-16px py-12px">
            <span className="text-ui font-medium text-ink">{t("usage.summary")}</span>
            {refreshing && <span role="status" className="text-label text-muted">{t("usage.updating")}</span>}
          </header>
          <div className="min-h-0 overflow-y-auto px-16px">
            {error && <p className="pt-10px text-caption text-warn">{t("usage.fetchError")}</p>}
            <div className="divide-y divide-hairline-soft">{snapshot.providers.map(provider => <UsageProviderSummary key={provider.id} provider={provider} now={now} compact onSelect={() => openDetails(provider.id)} />)}</div>
          </div>
          <footer className="shrink-0 border-t border-hairline-soft p-8px">
            <Button className="w-full justify-between text-caption" onClick={() => openDetails()}>{t("usage.viewDetails")}<Icon icon={ArrowUpRight} size={14} /></Button>
          </footer>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>}
  </>;
}
