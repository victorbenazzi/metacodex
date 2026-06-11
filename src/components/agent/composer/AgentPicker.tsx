import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Check } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import {
  selectEntityForChat,
  syncSelectedEntity,
  useAgentEntitiesStore,
} from "@/features/agent/entities.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { AgentAvatarBadge } from "@/components/agent/entities/AgentAvatar";

import { ComposerControl } from "./ComposerControl";

/**
 * Inline agent-entity picker for the composer. Selecting an entity pins the
 * chat to its persona + model + permission preset (the entity's home config
 * wins over the user's own picks until deselected); "No agent" is the default
 * and keeps today's plain-chat behavior byte for byte. The pick persists in
 * the `agent` settings slice (`entityId`) and re-resolves on boot.
 */
export function AgentPicker() {
  const { t } = useTranslation();
  const entities = useAgentEntitiesStore((s) => s.entities);
  const loaded = useAgentEntitiesStore((s) => s.loaded);
  const load = useAgentEntitiesStore((s) => s.load);
  const entityId = useSettingsDataStore((s) => s.settings.agent.entityId);

  // Hydrate the catalog once (the picker may render before the Agents page
  // ever opened) and re-bind the persisted selection to the chat store.
  useEffect(() => {
    if (!loaded) void load().then(syncSelectedEntity);
    else syncSelectedEntity();
  }, [loaded, load]);

  // Render nothing until an agent exists: the control would otherwise be a
  // dead-end for users who never touched the feature.
  if (loaded && entities.length === 0) return null;

  const selected = entities.find((e) => e.id === entityId) ?? null;

  return (
    <DropdownRoot>
      <DropdownTrigger asChild>
        <ComposerControl
          icon={Bot}
          label={selected ? selected.name : t("agent.composer.noAgent")}
          aria-label={t("agent.composer.agentLabel")}
        />
      </DropdownTrigger>
      <DropdownContent align="start" className="max-h-[340px] min-w-[240px] overflow-y-auto">
        <DropdownItem
          onSelect={() => selectEntityForChat(null)}
          trailing={!selected ? <Icon icon={Check} size={13} className="text-ink" /> : null}
        >
          <Icon icon={Bot} size={15} strokeWidth={1.75} className="text-muted" />
          <span className={!selected ? "text-ink" : undefined}>
            {t("agent.composer.noAgent")}
          </span>
        </DropdownItem>
        {entities.map((e) => {
          const active = e.id === entityId;
          return (
            <DropdownItem
              key={e.id}
              onSelect={() => selectEntityForChat(e)}
              trailing={active ? <Icon icon={Check} size={13} className="text-ink" /> : null}
            >
              <AgentAvatarBadge avatar={e.avatar} color={e.color} size="sm" />
              <span className={active ? "text-ink" : undefined}>{e.name}</span>
            </DropdownItem>
          );
        })}
        <DropdownItem onSelect={() => useAgentNavStore.getState().openAgents()}>
          <span className="text-muted">{t("agent.composer.manageAgents")}</span>
        </DropdownItem>
      </DropdownContent>
    </DropdownRoot>
  );
}
