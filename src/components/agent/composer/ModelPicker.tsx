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
import { isModelEnabled } from "@/features/settings/settings.types";

import { ComposerControl } from "./ComposerControl";

/**
 * Inline model picker for the composer. Groups every model under its provider
 * (opencode-go, OpenAI, …) and writes the choice to the persisted `agent`
 * settings slice, so the Settings dialog and the composer stay in sync. The
 * catalog is fetched lazily the first time the menu opens.
 *
 * Only models enabled in Settings → Agent → Models show up (default: the
 * opencode-go provider). A previously selected model that was later disabled
 * keeps working and keeps its label; it just leaves the list.
 */
export function ModelPicker() {
  const { t } = useTranslation();
  const allProviders = useAgentRuntimeStore((s) => s.providers);
  const loadingModels = useAgentRuntimeStore((s) => s.loadingModels);
  const loadModels = useAgentRuntimeStore((s) => s.loadModels);
  const providerId = useSettingsDataStore((s) => s.settings.agent.providerId);
  const modelId = useSettingsDataStore((s) => s.settings.agent.modelId);
  const enabledModels = useSettingsDataStore((s) => s.settings.agent.enabledModels);
  const update = useSettingsDataStore((s) => s.update);

  const providers = useMemo(
    () =>
      allProviders
        .map((p) => ({
          ...p,
          models: p.models.filter((m) => isModelEnabled(enabledModels, p.id, m.id)),
        }))
        .filter((p) => p.models.length > 0),
    [allProviders, enabledModels],
  );

  const label = useMemo(() => {
    for (const p of allProviders) {
      if (p.id !== providerId) continue;
      const m = p.models.find((m) => m.id === modelId);
      if (m) return m.name;
    }
    return modelId || t("agent.composer.modelEmpty");
  }, [allProviders, providerId, modelId, t]);

  return (
    <DropdownRoot
      onOpenChange={(open) => {
        // Refetch only when the CATALOG is empty; a user who disabled every
        // model would otherwise trigger a pointless refetch per open.
        if (open && allProviders.length === 0) void loadModels();
      }}
    >
      <DropdownTrigger asChild>
        <ComposerControl icon={Sparkles} label={label} aria-label={t("agent.composer.modelLabel")} />
      </DropdownTrigger>
      <DropdownContent side="top" align="start" className="max-h-[340px] min-w-[240px] overflow-y-auto">
        {providers.length === 0 ? (
          <div className="px-[10px] py-[8px] text-caption text-muted">
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
