import { useCallback } from "react";

import { CMD, invoke } from "@/lib/ipc";

import { browserApi } from "./browser.service";
import { useBrowserUiStore } from "./browser.store";
import { normalizeBrowserUrl } from "./url";

export type BrowserOpenTarget = "app" | "system";
export interface BrowserFeedback {
  tone: "error" | "success";
  title: string;
  detail?: string;
}

export function useBrowserNavigation(input: {
  invalidAddress: string;
  navigateFailed: string;
  onFeedback: (feedback: BrowserFeedback) => void;
}) {
  const go = useCallback(async (raw: string, target: BrowserOpenTarget = "app") => {
    const next = normalizeBrowserUrl(raw);
    if (!next) {
      input.onFeedback({ tone: "error", title: input.invalidAddress });
      return;
    }
    if (target === "system") {
      await invoke(CMD.openExternalUrl, { url: next }).catch(() => undefined);
      return;
    }
    const store = useBrowserUiStore.getState();
    store.setAddress(next);
    store.setLoading(true);
    try {
      await browserApi.navigate(next);
      store.setUrl(next);
    } catch (error) {
      store.setLoading(false);
      store.setUrl(useBrowserUiStore.getState().url);
      input.onFeedback({
        tone: "error",
        title: input.navigateFailed,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, [input]);

  const openExternal = useCallback(async () => {
    const url = useBrowserUiStore.getState().url;
    if (url) await invoke(CMD.openExternalUrl, { url }).catch(() => undefined);
  }, []);

  const home = useCallback(async () => {
    const store = useBrowserUiStore.getState();
    store.setUrl(null);
    store.setAddress("");
    await browserApi.setMode("browse").catch(() => undefined);
    await browserApi.hide().catch(() => undefined);
  }, []);

  const goBack = useCallback(() => browserApi.goBack().catch(() => undefined), []);
  const goForward = useCallback(() => browserApi.goForward().catch(() => undefined), []);
  const reload = useCallback(() => browserApi.reload().catch(() => undefined), []);

  return { go, home, openExternal, goBack, goForward, reload };
}
