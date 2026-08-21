import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { BrowserChrome } from "@/components/browser/BrowserChrome";
import { BrowserDrawDock } from "@/components/browser/BrowserDrawDock";
import { BrowserStartPage } from "@/components/browser/BrowserStartPage";
import { useBrowserBridge } from "@/features/browser/useBrowserBridge";
import { useBrowserDelivery } from "@/features/browser/useBrowserDelivery";
import { useBrowserHost } from "@/features/browser/useBrowserHost";
import { useBrowserNavigation } from "@/features/browser/useBrowserNavigation";
import { useBrowserRuntimeContext } from "@/features/browser/useBrowserRuntimeContext";
import { useBrowserUiStore } from "@/features/browser/browser.store";
import { useDevServerActions } from "@/features/browser/useDevServerActions";
import { isBlankBrowserUrl } from "@/features/browser/url";

interface BrowserPanelProps {
  active: boolean;
}

export function BrowserPanel({ active }: BrowserPanelProps) {
  const { t } = useTranslation();
  const url = useBrowserUiStore((state) => state.url);
  const address = useBrowserUiStore((state) => state.address);
  const mode = useBrowserUiStore((state) => state.mode);
  const contextDetail = useBrowserUiStore((state) => state.contextDetail);
  const loading = useBrowserUiStore((state) => state.loading);
  const expanded = useBrowserUiStore((state) => state.expanded);
  const setAddress = useBrowserUiStore((state) => state.setAddress);
  const setContextDetail = useBrowserUiStore((state) => state.setContextDetail);
  const setExpanded = useBrowserUiStore((state) => state.setExpanded);
  const toggleExpanded = useBrowserUiStore((state) => state.toggleExpanded);
  const { browserTabOpen, servers } = useBrowserRuntimeContext();
  const {
    capturing,
    notice,
    pushFeedback,
    requestMode,
    sendViewport,
    clearDraw,
  } = useBrowserDelivery();
  const navigation = useBrowserNavigation({
    invalidAddress: t("browser.invalidAddress"),
    navigateFailed: t("browser.navigateFailed"),
    onFeedback: pushFeedback,
  });
  const { stoppingServerIds, stopServer } = useDevServerActions(servers);
  const pageLoaded = !isBlankBrowserUrl(url);
  const hostRef = useBrowserHost({ active, pageLoaded, mode, expanded });

  useBrowserBridge();

  useEffect(() => {
    if (!browserTabOpen) setExpanded(false);
  }, [browserTabOpen, setExpanded]);

  useEffect(() => {
    if (!active) void requestMode("browse");
  }, [active, requestMode]);

  useEffect(() => {
    if (!active || mode === "browse") return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void requestMode("browse");
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [active, mode, requestMode]);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t("browser.aria")}>
      <BrowserChrome
        address={address}
        mode={mode}
        contextDetail={contextDetail}
        loading={loading}
        expanded={expanded}
        pageLoaded={pageLoaded}
        capturing={capturing}
        notice={notice}
        onAddressChange={setAddress}
        onGo={(next) => void navigation.go(next)}
        onBack={() => void navigation.goBack()}
        onForward={() => void navigation.goForward()}
        onReload={() => void navigation.reload()}
        onMode={(next) => void requestMode(next)}
        onCaptureViewport={() => void sendViewport()}
        onToggleExpand={toggleExpanded}
        onContextDetail={setContextDetail}
        onOpenExternal={() => void navigation.openExternal()}
        onHome={() => void navigation.home()}
      />

      <div className="relative min-h-0 flex-1">
        <div
          ref={hostRef}
          className="absolute inset-0"
          style={{ display: pageLoaded ? "block" : "none" }}
        />
        <div className="absolute inset-0" style={{ display: pageLoaded ? "none" : "block" }}>
          <BrowserStartPage
            servers={servers}
            stoppingServerIds={stoppingServerIds}
            onOpen={(next, target) => void navigation.go(next, target)}
            onStop={(server) => void stopServer(server)}
          />
        </div>
        {pageLoaded && mode === "draw" ? (
          <BrowserDrawDock
            sending={capturing}
            onClear={() => void clearDraw()}
            onCancel={() => void requestMode("browse")}
            onSend={() => void sendViewport("draw")}
          />
        ) : null}
      </div>
    </section>
  );
}
