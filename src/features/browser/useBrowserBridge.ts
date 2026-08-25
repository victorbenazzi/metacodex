import { useEffect } from "react";

import {
  EV,
  listenWhileMounted,
  type BrowserModePayload,
  type BrowserNavigatedPayload,
} from "@/lib/events";

import { useBrowserUiStore } from "./browser.store";
import { isBlankBrowserUrl } from "./url";

export function useBrowserBridge(): void {
  useEffect(() => {
    const stopNavigation = listenWhileMounted<BrowserNavigatedPayload>(
      EV.browserNavigated,
      (event) => {
        const next = event.payload;
        const store = useBrowserUiStore.getState();
        if (isBlankBrowserUrl(next.url) || next.url.includes("mcx.invalid")) {
          store.setUrl(null);
          store.setAddress("");
          store.setLoading(false);
          return;
        }
        store.setLoading(next.loading);
        store.setUrl(next.url, next.title || undefined);
        if (next.address) store.setAddress(next.address);
      },
    );
    const stopMode = listenWhileMounted<BrowserModePayload>(EV.browserMode, (event) => {
      useBrowserUiStore.getState().setMode(event.payload);
    });
    return () => {
      stopNavigation();
      stopMode();
    };
  }, []);
}
