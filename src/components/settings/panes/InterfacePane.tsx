import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { PaneHeader, Row } from "@/components/settings/SettingsPrimitives";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import {
  DEFAULT_CLI_REGISTRY,
  cliCategory,
  isAgentEnabled,
} from "@/features/terminal/cli-registry";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import type {
  ExplorerIconStyle,
  LayoutMode,
  UiDensity,
} from "@/features/settings/settings.types";

export function InterfacePane() {
  const { t } = useTranslation();
  const enabledAgents = useSettingsDataStore((s) => s.settings.interface.enabledAgents);
  const iconStyle = useSettingsDataStore((s) => s.settings.interface.explorerIconStyle);
  const density = useSettingsDataStore((s) => s.settings.interface.uiDensity);
  const layoutMode = useSettingsDataStore((s) => s.settings.interface.layoutMode);
  const update = useSettingsDataStore((s) => s.update);

  // Stable order: coding agents first (same order as the registry), then autonomous.
  const ordered = [
    ...DEFAULT_CLI_REGISTRY.filter((c) => cliCategory(c) === "coding"),
    ...DEFAULT_CLI_REGISTRY.filter((c) => cliCategory(c) === "autonomous"),
  ];

  const setEnabled = (id: string, next: boolean) => {
    update("interface", { enabledAgents: { ...enabledAgents, [id]: next } });
  };

  const iconStyleOptions: { id: ExplorerIconStyle; label: string }[] = [
    { id: "mono", label: t("settings.interface.iconStyleMono") },
    { id: "color", label: t("settings.interface.iconStyleColor") },
  ];

  const densityOptions: { id: UiDensity; label: string }[] = [
    { id: "compact", label: t("settings.interface.densityCompact") },
    { id: "comfortable", label: t("settings.interface.densityComfortable") },
    { id: "spacious", label: t("settings.interface.densitySpacious") },
  ];

  const layoutOptions: { id: LayoutMode; label: string }[] = [
    { id: "horizontal", label: t("settings.interface.layoutHorizontal") },
    { id: "vertical", label: t("settings.interface.layoutVertical") },
  ];

  return (
    <div>
      <PaneHeader
        title={t("settings.interface.title")}
        description={t("settings.interface.description")}
      />

      <Row
        label={t("settings.interface.layout")}
        hint={t("settings.interface.layoutHint")}
      >
        <Segmented
          value={layoutMode}
          options={layoutOptions}
          onChange={(v) => update("interface", { layoutMode: v })}
        />
      </Row>

      <Row
        label={t("settings.interface.density")}
        hint={t("settings.interface.densityHint")}
      >
        <Segmented
          value={density}
          options={densityOptions}
          onChange={(v) => update("interface", { uiDensity: v })}
        />
      </Row>

      <Row
        label={t("settings.interface.iconStyle")}
        hint={t("settings.interface.iconStyleHint")}
      >
        <Segmented
          value={iconStyle}
          options={iconStyleOptions}
          onChange={(v) => update("interface", { explorerIconStyle: v })}
        />
      </Row>

      <div className="mb-[8px] mt-[20px] flex items-center justify-between">
        <h3 className="editorial-caps text-muted">
          {t("settings.interface.launcherVisibilityTitle")}
        </h3>
      </div>
      <p className="mb-[10px] text-caption text-muted">
        {t("settings.interface.launcherVisibilityHint")}
      </p>

      <ul className="flex flex-col">
        {ordered.map((cli) => {
          const BrandIcon = CLI_BRAND_ICONS[cli.id];
          const enabled = isAgentEnabled(cli.id, enabledAgents);
          return (
            <li
              key={cli.id}
              className="flex items-center justify-between gap-[16px] border-b border-hairline-soft py-[12px] last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-[10px]">
                {BrandIcon ? (
                  <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center text-ink">
                    <BrandIcon size={16} />
                  </span>
                ) : null}
                <div className="min-w-0">
                  <div className="flex items-center gap-[8px]">
                    <span className="text-ui font-medium text-ink">{cli.label}</span>
                    {cliCategory(cli) === "autonomous" ? (
                      <Badge tone="muted">{t("settings.interface.autonomousTag")}</Badge>
                    ) : null}
                  </div>
                  <div className="mt-[2px] truncate font-mono text-label text-muted">
                    {cli.command}
                  </div>
                </div>
              </div>
              <Switch
                checked={enabled}
                onChange={(v) => setEnabled(cli.id, v)}
                ariaLabel={t("settings.interface.toggleAria", { name: cli.label })}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
