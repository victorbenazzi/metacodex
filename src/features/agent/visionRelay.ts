import { useSettingsDataStore } from "@/features/settings/settings.data.store";

import { oneShotPrompt } from "./oc";
import { findModel, firstVisionModel, useAgentRuntimeStore } from "./runtime.store";
import type { OutgoingPart } from "./attachments";

/**
 * Vision relay: when the active chat model can't see images (`attachment:
 * false` in the catalog), the image parts take a one-shot detour through a
 * vision-capable model that describes them in detail; the description rides
 * the real message as a synthetic text part. The throwaway session is owned
 * by `oc.oneShotPrompt`, which archives it on every path (success or failure)
 * so it never pollutes the sidebar history.
 *
 * The relay model comes from `settings.agent.visionProviderId/visionModelId`;
 * empty = auto (first attachment-capable model, preferring the active
 * provider).
 */

const DESCRIBE_PROMPT =
  "Describe the attached image(s) in detail for a coding agent that cannot see them. " +
  "Transcribe any text, code, or error messages verbatim. Describe layout, UI elements, " +
  "colors, and anything notable. If there are multiple images, describe each one in order.";

export type RelayResult =
  | { ok: true; description: string }
  | { ok: false; error: "no-vision-model" | "relay-failed" };

/** Pick the relay model: the settings choice (default Kimi K2.5 on GO) when
 *  the catalog confirms it can see images, else auto (first vision model,
 *  preferring the active provider). With no catalog yet, trust the setting. */
export function resolveVisionModel(): { providerID: string; modelID: string } | null {
  const ag = useSettingsDataStore.getState().settings.agent;
  const providers = useAgentRuntimeStore.getState().providers;
  if (ag.visionProviderId && ag.visionModelId) {
    const m = findModel(providers, ag.visionProviderId, ag.visionModelId);
    if (providers.length === 0 || m?.attachment) {
      return { providerID: ag.visionProviderId, modelID: ag.visionModelId };
    }
    // Configured model left the catalog or can't see images: fall through.
  }
  const auto = firstVisionModel(providers, ag.providerId);
  return auto ? { providerID: auto.providerId, modelID: auto.modelId } : null;
}

export async function describeImages(
  base: string,
  directory: string | null,
  imageParts: OutgoingPart[],
): Promise<RelayResult> {
  const model = resolveVisionModel();
  if (!model) return { ok: false, error: "no-vision-model" };

  const description = await oneShotPrompt(base, directory, {
    parts: [...imageParts, { type: "text", text: DESCRIBE_PROMPT }],
    model,
  });
  return description
    ? { ok: true, description }
    : { ok: false, error: "relay-failed" };
}
