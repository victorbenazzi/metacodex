import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  EV,
  listenWhileMounted,
  type BrowserCaptureSelectedPayload,
  type BrowserPickedPayload,
} from "@/lib/events";
import { isAppError } from "@/lib/ipc";

import { deliverBrowserVisual, type BrowserDeliveryRequest } from "./browserDelivery";
import { setBrowserModeAfterCompositor } from "./browserModeReady";
import { browserApi, type BrowserMode } from "./browser.service";
import { useBrowserUiStore } from "./browser.store";
import { formatPickContext } from "./context";
import { sendVisualToCli } from "./sendToAgent";
import { formatViewportContext } from "./visualDelivery";
import type { BrowserFeedback } from "./useBrowserNavigation";

export function useBrowserDelivery() {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const drawCleanupPending = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<BrowserFeedback | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(
      () => setNotice(null),
      notice.tone === "success" ? 2000 : 4000,
    );
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const requestMode = useCallback(async (mode: BrowserMode) => {
    if (inFlight.current) return;
    if (mode === "draw" && drawCleanupPending.current) {
      try {
        await browserApi.clearDraw();
        drawCleanupPending.current = false;
      } catch (error) {
        setNotice({
          tone: "error",
          title: t("browser.drawClearFailed"),
          detail: isAppError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error),
        });
        return;
      }
    }
    try {
      await browserApi.setMode(mode);
    } catch (error) {
      setNotice({
        tone: "error",
        title: t("browser.modeFailed"),
        detail: isAppError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }, [t]);

  const deliver = useCallback(async (request: BrowserDeliveryRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setCapturing(true);
    try {
      const result = await deliverBrowserVisual(request, {
        setModeAfterCompositor: setBrowserModeAfterCompositor,
        clearDraw: browserApi.clearDraw,
        capture: browserApi.capture,
        send: sendVisualToCli,
      });
      if (result.status === "sent") {
        if (request.previousMode === "draw") {
          drawCleanupPending.current = result.cleanupPending === true;
        }
        setNotice({
          tone: "success",
          title: t("browser.sentToAgent"),
          detail: result.cleanupPending ? t("browser.drawCleanupPending") : undefined,
        });
      } else if (result.status === "no-cli") {
        setNotice({ tone: "error", title: t("browser.needAgent") });
      } else {
        setNotice({
          tone: "error",
          title: result.phase === "mode"
            ? t("browser.modeFailed")
            : result.phase === "capture"
              ? t("browser.captureFailed")
              : t("browser.sendFailed"),
          detail: result.error.message,
        });
      }
    } finally {
      inFlight.current = false;
      setCapturing(false);
    }
  }, [t]);

  useEffect(() => listenWhileMounted<BrowserPickedPayload>(EV.browserPicked, (event) => {
    const detail = useBrowserUiStore.getState().contextDetail;
    void deliver({
      previousMode: "pick",
      crop: event.payload.rect,
      buildContext: (path) => formatPickContext(event.payload, path, detail),
    });
  }), [deliver]);

  useEffect(
    () => listenWhileMounted<BrowserCaptureSelectedPayload>(
      EV.browserCaptureSelected,
      (event) => {
        const url = useBrowserUiStore.getState().url;
        void deliver({
          previousMode: "capture",
          crop: event.payload,
          buildContext: (path) => formatViewportContext({
            url,
            crop: event.payload,
            screenshotPath: path,
          }),
        });
      },
    ),
    [deliver],
  );

  const sendViewport = useCallback(async (previousMode?: BrowserMode) => {
    const store = useBrowserUiStore.getState();
    const mode = previousMode ?? store.mode;
    const url = store.url;
    await deliver({
      previousMode: mode,
      buildContext: (path) => formatViewportContext({ url, screenshotPath: path }),
    });
  }, [deliver]);

  const clearDraw = useCallback(async () => {
    try {
      await browserApi.clearDraw();
    } catch (error) {
      setNotice({
        tone: "error",
        title: t("browser.drawClearFailed"),
        detail: isAppError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }, [t]);

  return {
    capturing,
    notice,
    pushFeedback: setNotice,
    requestMode,
    sendViewport,
    clearDraw,
  };
}
