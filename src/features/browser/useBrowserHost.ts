import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { BROWSER_DRAW_DOCK_H } from "@/components/browser/BrowserDrawDock";
import { useChromeOverlayOpen } from "@/features/ui/overlayLock.store";

import { browserApi, type BrowserMode } from "./browser.service";

export function useBrowserHost(input: {
  active: boolean;
  pageLoaded: boolean;
  mode: BrowserMode;
  expanded: boolean;
}): RefObject<HTMLDivElement | null> {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boundsRaf = useRef(0);
  const overlayOpen = useChromeOverlayOpen();
  const visible = input.active && input.pageLoaded && !overlayOpen;

  const syncBounds = useCallback(() => {
    if (boundsRaf.current) return;
    boundsRaf.current = requestAnimationFrame(() => {
      boundsRaf.current = 0;
      const element = hostRef.current;
      if (!visible || !element) {
        void browserApi.hide().catch(() => undefined);
        return;
      }
      const rect = element.getBoundingClientRect();
      const dockHeight = input.mode === "draw" ? BROWSER_DRAW_DOCK_H : 0;
      void browserApi
        .setBounds({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: Math.max(0, rect.height - dockHeight),
          visible: rect.width >= 8 && rect.height - dockHeight >= 8,
        })
        .catch((error) => console.warn("[browser] bounds failed", error));
    });
  }, [input.mode, visible]);

  useLayoutEffect(() => {
    syncBounds();
    const element = hostRef.current;
    if (!element) return;
    const observer = new ResizeObserver(syncBounds);
    observer.observe(element);
    window.addEventListener("resize", syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      if (boundsRaf.current) cancelAnimationFrame(boundsRaf.current);
    };
  }, [input.expanded, syncBounds]);

  useEffect(() => {
    if (!input.active) void browserApi.hide().catch(() => undefined);
  }, [input.active]);

  useEffect(() => () => {
    void browserApi.hide().catch(() => undefined);
  }, []);

  return hostRef;
}
