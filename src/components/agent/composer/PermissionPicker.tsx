import { useTranslation } from "react-i18next";
import { Check, ShieldAlert, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import type { PermissionPreset } from "@/features/agent/opencode";

import { ComposerControl } from "./ComposerControl";

interface PresetMeta {
  value: PermissionPreset;
  icon: LucideIcon;
  danger?: boolean;
}

const PRESETS: PresetMeta[] = [
  { value: "ask", icon: ShieldCheck },
  { value: "auto-edit", icon: ShieldCheck },
  { value: "full-auto", icon: ShieldAlert, danger: true },
];

/**
 * Permission posture for the agent. Each preset maps to an opencode
 * `PermissionRuleset` applied when a session is created (and PATCHed onto the
 * live session when changed mid-chat). "Full auto" carries a quiet danger tone , 
 * a red glyph, never a shout, so the risk reads without alarming.
 */
export function PermissionPicker() {
  const { t } = useTranslation();
  const preset = useSettingsDataStore((s) => s.settings.agent.permissionPreset);
  const update = useSettingsDataStore((s) => s.update);
  const applyPreset = useAgentChatStore((s) => s.applyPermissionPreset);

  const current = PRESETS.find((p) => p.value === preset) ?? PRESETS[0];

  const choose = (value: PermissionPreset) => {
    update("agent", { permissionPreset: value });
    void applyPreset();
  };

  return (
    <DropdownRoot>
      <DropdownTrigger asChild>
        <ComposerControl
          icon={current.icon}
          tone={current.danger ? "danger" : "default"}
          label={t(`agent.permission.${preset}`)}
          aria-label={t("agent.composer.askPermissions")}
        />
      </DropdownTrigger>
      <DropdownContent side="top" align="start" className="min-w-[280px]">
        {PRESETS.map((p) => {
          const active = p.value === preset;
          return (
            <DropdownItem
              key={p.value}
              onSelect={() => choose(p.value)}
              trailing={active ? <Icon icon={Check} size={13} className="text-ink" /> : null}
            >
              <Icon
                icon={p.icon}
                size={15}
                strokeWidth={2}
                className={p.danger ? "text-danger" : "text-muted"}
              />
              <span className="flex flex-col gap-[1px]">
                <span className={active ? "text-ink" : undefined}>
                  {t(`agent.permission.${p.value}`)}
                </span>
                <span className="text-label font-normal text-muted">
                  {t(`agent.permission.${p.value}Desc`)}
                </span>
              </span>
            </DropdownItem>
          );
        })}
      </DropdownContent>
    </DropdownRoot>
  );
}
