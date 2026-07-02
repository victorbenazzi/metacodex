import { useTranslation } from "react-i18next";

import { NumberStepper } from "@/components/ui/NumberStepper";
import { PaneHeader, Row } from "@/components/settings/SettingsPrimitives";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";

export function AdvancedPane() {
  const { t } = useTranslation();
  const perf = useSettingsDataStore((s) => s.settings.performance);
  const update = useSettingsDataStore((s) => s.update);

  return (
    <div>
      <PaneHeader title={t("settings.advanced.title")} description={t("settings.advanced.description")} />

      <Row label={t("settings.advanced.saveDebounce")} hint={t("settings.advanced.saveDebounceHint")}>
        <NumberStepper
          ariaLabel={t("settings.advanced.saveDebounce")}
          value={perf.workspaceSaveDebounceMs}
          min={0}
          max={5000}
          step={50}
          onChange={(v) => update("performance", { workspaceSaveDebounceMs: v })}
        />
      </Row>

      <Row label={t("settings.advanced.searchDebounce")} hint={t("settings.advanced.searchDebounceHint")}>
        <NumberStepper
          ariaLabel={t("settings.advanced.searchDebounce")}
          value={perf.searchDebounceMs}
          min={0}
          max={5000}
          step={50}
          onChange={(v) => update("performance", { searchDebounceMs: v })}
        />
      </Row>
    </div>
  );
}
