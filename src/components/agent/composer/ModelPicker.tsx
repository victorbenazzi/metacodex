import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, Sparkles } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import {
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownRoot,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { useAgentRuntimeStore } from "@/features/agent/runtime.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";

import { ComposerControl } from "./ComposerControl";

/**
 * Inline model picker for the composer. Groups every model under its provider
 * (opencode-go, OpenAI, …) and writes the choice to the persisted `agent`
 * settings slice, so the Settings dialog and the composer stay in sync. The
 * catalog is fetched lazily the first time the menu opens.
 */
export function ModelPicker() {
  const { t } = useTranslation();
  const providers = useAgentRuntimeStore((s) => s.providers);
  const loadingModels = useAgentRuntimeStore((s) => s.loadingModels);
  const loadModels = useAgentRuntimeStore((s) => s.loadModels);
  const providerId = useSettingsDataStore((s) => s.settings.agent.providerId);
  const modelId = useSettingsDataStore((s) => s.settings.agent.modelId);
  const update = useSettingsDataStore((s) => s.update);

  const label = useMemo(() => {
    for (const p of providers) {
      if (p.id !== providerId) continue;
      const m = p.models.find((m) => m.id === modelId);
      if (m) return m.name;
    }
    return modelId || t("agent.composer.modelEmpty");
  }, [providers, providerId, modelId, t]);

  return (
    <DropdownRoot
      onOpenChange={(open) => {
        if (open && providers.length === 0) void loadModels();
      }}
    >
      <DropdownTrigger asChild>
        <ComposerControl icon={Sparkles} label={label} aria-label={t("agent.composer.modelLabel")} />
      </DropdownTrigger>
      <DropdownContent align="start" className="max-h-[340px] min-w-[240px] overflow-y-auto">
        {providers.length === 0 ? (
          <div className="px-[10px] py-[8px] text-[12px] text-muted">
            {loadingModels ? t("agent.settings.loadingModels") : t("agent.settings.noModels")}
          </div>
        ) : (
          providers.map((p) => (
            <Fragment key={p.id}>
              <DropdownLabel>{p.name}</DropdownLabel>
              {p.models.map((m) => {
                const active = p.id === providerId && m.id === modelId;
                return (
                  <DropdownItem
                    key={m.id}
                    onSelect={() => update("agent", { providerId: p.id, modelId: m.id })}
                    trailing={active ? <Icon icon={Check} size={13} className="text-ink" /> : null}
                  >
                    <span className={active ? "text-ink" : undefined}>{m.name}</span>
                  </DropdownItem>
                );
              })}
            </Fragment>
          ))
        )}
      </DropdownContent>
    </DropdownRoot>
  );
}
