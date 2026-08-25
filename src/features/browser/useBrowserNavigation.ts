import { useCallback } from "react";

import { CMD, invoke, isAppError } from "@/lib/ipc";

import { browserApi } from "./browser.service";
import { useBrowserUiStore } from "./browser.store";
import { browserExternalTarget, normalizeBrowserUrl } from "./url";

export type BrowserOpenTarget = "app" | "system";
export interface BrowserFeedback {
  tone: "error" | "success";
  title: string;
  detail?: string;
}

export function useBrowserNavigation(input: {
  invalidAddress: string;
  navigateFailed: string;
  externalOpenFailed: string;
  onFeedback: (feedback: BrowserFeedback) => void;
}) {
  const openInSystem = useCallback(async (raw: string) => {
    const target = browserExternalTarget(raw);
    if (!target) {
      input.onFeedback({ tone: "error", title: input.invalidAddress });
      return;
    }
    try {
      if (target.command === "openExternalPath") {
        await invoke(CMD.openExternalPath, { path: target.value });
      } else {
        await invoke(CMD.openExternalUrl, { url: target.value });
      }
    } catch (error) {
      input.onFeedback({
        tone: "error",
        title: input.externalOpenFailed,
        detail: isAppError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }, [input]);

  const go = useCallback(async (raw: string, target: BrowserOpenTarget = "app") => {
    const next = normalizeBrowserUrl(raw);
    if (!next) {
      input.onFeedback({ tone: "error", title: input.invalidAddress });
      return;
    }
    if (target === "system") {
      await openInSystem(next);
      return;
    }
    const store = useBrowserUiStore.getState();
    store.setAddress(next);
    store.setLoading(true);
    try {
      const result = await browserApi.navigate(next);
      store.setUrl(result.url);
      store.setAddress(result.address);
    } catch (error) {
      store.setLoading(false);
      input.onFeedback({
        tone: "error",
        title: input.navigateFailed,
        detail: isAppError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }, [input, openInSystem]);

  const openExternal = useCallback(async () => {
    const { address, url } = useBrowserUiStore.getState();
    const target = address || url;
    if (target) await openInSystem(target);
  }, [openInSystem]);

  const goBack = useCallback(() => browserApi.goBack().catch(() => undefined), []);
  const goForward = useCallback(() => browserApi.goForward().catch(() => undefined), []);
  const reload = useCallback(() => browserApi.reload().catch(() => undefined), []);

  return { go, openExternal, goBack, goForward, reload };
}
