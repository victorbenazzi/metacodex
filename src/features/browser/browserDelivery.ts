import type { AppError } from "@/lib/ipc";
import { isAppError } from "@/lib/ipc";

import type { BrowserMode, BrowserPick } from "./browser.service";
import type { SendVisualResult } from "./sendToAgent";

type BrowserCrop = BrowserPick["rect"];

export type BrowserDeliveryResult =
  | (Extract<SendVisualResult, { status: "sent" }> & { cleanupPending?: boolean })
  | Extract<SendVisualResult, { status: "no-cli" }>
  | {
      status: "failed";
      phase: "mode" | "capture" | "delivery";
      error: AppError;
    };

export interface BrowserDeliveryRequest {
  previousMode: BrowserMode;
  crop?: BrowserCrop;
  buildContext: (screenshotPath: string) => string;
}

export interface BrowserDeliveryDependencies {
  setModeAfterCompositor: (mode: BrowserMode) => Promise<void>;
  clearDraw: () => Promise<void>;
  capture: (crop: BrowserCrop | undefined, expectedMode: BrowserMode) => Promise<{ path: string }>;
  send: (context: string) => Promise<SendVisualResult>;
}

export async function deliverBrowserVisual(
  request: BrowserDeliveryRequest,
  dependencies: BrowserDeliveryDependencies,
): Promise<BrowserDeliveryResult> {
  const { previousMode } = request;
  const hidesOverlayBeforeCapture = previousMode === "pick" || previousMode === "capture";
  if (hidesOverlayBeforeCapture) {
    try {
      await dependencies.setModeAfterCompositor("browse");
    } catch (error) {
      const modeFailure = failure("mode", error, "mode_change_failed");
      const restoreFailure = await restoreMode(previousMode, dependencies);
      return restoreFailure ?? modeFailure;
    }
  }

  let screenshotPath: string;
  try {
    const captureMode = previousMode === "draw" ? "draw" : "browse";
    screenshotPath = (await dependencies.capture(request.crop, captureMode)).path;
  } catch (error) {
    const restoreFailure = await restoreMode(previousMode, dependencies);
    return restoreFailure ?? failure("capture", error, "capture_failed");
  }

  const delivery = await dependencies.send(request.buildContext(screenshotPath));
  if (delivery.status === "sent") {
    if (previousMode === "draw") {
      try {
        await dependencies.setModeAfterCompositor("browse");
      } catch {
        return { ...delivery, cleanupPending: true };
      }
      try {
        await dependencies.clearDraw();
      } catch {
        try {
          await dependencies.clearDraw();
        } catch {
          return { ...delivery, cleanupPending: true };
        }
      }
    }
    return delivery;
  }

  const restoreFailure = hidesOverlayBeforeCapture
    ? await restoreMode(previousMode, dependencies)
    : null;
  if (restoreFailure) return restoreFailure;
  if (delivery.status === "no-cli") return delivery;
  return {
    status: "failed",
    phase: "delivery",
    error: delivery.error,
  };
}

async function restoreMode(
  previousMode: BrowserMode,
  dependencies: BrowserDeliveryDependencies,
): Promise<BrowserDeliveryResult | null> {
  if (previousMode === "browse") return null;
  try {
    await dependencies.setModeAfterCompositor(previousMode);
    return null;
  } catch (error) {
    return failure("mode", error, "mode_restore_failed");
  }
}

function failure(
  phase: "mode" | "capture",
  error: unknown,
  code: string,
): BrowserDeliveryResult {
  return {
    status: "failed",
    phase,
    error: isAppError(error)
      ? error
      : {
          code,
          message: error instanceof Error ? error.message : String(error),
        },
  };
}
