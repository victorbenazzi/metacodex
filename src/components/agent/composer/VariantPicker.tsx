import { useTranslation } from "react-i18next";
import { Check, Gauge } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { findModel, orderedVariants, useAgentRuntimeStore } from "@/features/agent/runtime.store";
import { DEFAULT_MODEL } from "@/features/agent/chat.store";
import { effectiveModelId as resolveEffectiveModel } from "@/features/agent/opencode";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { modelKey } from "@/features/settings/settings.types";

import { ComposerControl } from "./ComposerControl";

/**
 * Reasoning-effort selector. Only exists while the active model exposes
 * variants (low / medium / high / max in the opencode catalog); it slides in
 * beside the model picker when such a model is chosen. The choice persists
 * per model (`settings.agent.variantByModel`) and rides the message POST as
 * `variant`; "Auto" (no entry) leaves the model's default effort.
 */
export function VariantPicker() {
  const { t } = useTranslation();
  const providers = useAgentRuntimeStore((s) => s.providers);
  const providerId = useSettingsDataStore((s) => s.settings.agent.providerId);
  const modelId = useSettingsDataStore((s) => s.settings.agent.modelId);
  const mode = useSettingsDataStore((s) => s.settings.agent.mode);
  const variantByModel = useSettingsDataStore((s) => s.settings.agent.variantByModel);
  const update = useSettingsDataStore((s) => s.update);

  // Same effective-model resolution the chat send uses, INCLUDING the swarm
  // orchestrator swap; otherwise the picker shows efforts for a model the
  // send will never use.
  const effProvider = providerId || "opencode-go";
  const effectiveModelId = resolveEffectiveModel(effProvider, modelId || DEFAULT_MODEL, mode);
  const model = findModel(providers, effProvider, effectiveModelId);
  const variants = orderedVariants(model?.variants ?? []);
  if (variants.length === 0) return null;

  const key = modelKey(effProvider, effectiveModelId);
  const current = variantByModel[key] ?? "";
  const active = variants.includes(current) ? current : "";

  const choose = (variant: string) => {
    const next = { ...variantByModel };
    if (variant) next[key] = variant;
    else delete next[key];
    update("agent", { variantByModel: next });
  };

  return (
    // Keyed by model so the slide replays when a variant-capable model is picked.
    <div key={key} className="animate-slide-in-left">
      <DropdownRoot>
        <DropdownTrigger asChild>
          <ComposerControl
            icon={Gauge}
            label={active ? variantLabel(active) : t("agent.composer.variantAuto")}
            aria-label={t("agent.composer.variantLabel")}
          />
        </DropdownTrigger>
        <DropdownContent align="start" className="min-w-[160px]">
          <DropdownItem
            onSelect={() => choose("")}
            trailing={!active ? <Icon icon={Check} size={13} className="text-ink" /> : null}
          >
            <span className={!active ? "text-ink" : undefined}>
              {t("agent.composer.variantAuto")}
            </span>
          </DropdownItem>
          {variants.map((v) => (
            <DropdownItem
              key={v}
              onSelect={() => choose(v)}
              trailing={active === v ? <Icon icon={Check} size={13} className="text-ink" /> : null}
            >
              <span className={active === v ? "text-ink" : undefined}>{variantLabel(v)}</span>
            </DropdownItem>
          ))}
        </DropdownContent>
      </DropdownRoot>
    </div>
  );
}

/** "low" → "Low"; unknown names keep their casing quirkless. */
function variantLabel(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}
