import { useTranslation } from "react-i18next";

import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { PaneHeader, Row } from "@/components/settings/SettingsPrimitives";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import type { UiScale } from "@/features/settings/settings.types";

export function AccessibilityPane() {
  const { t } = useTranslation();
  const uiScale = useSettingsDataStore((s) => s.settings.accessibility.uiScale);
  const screenReaderMode = useSettingsDataStore(
    (s) => s.settings.accessibility.screenReaderMode,
  );
  const update = useSettingsDataStore((s) => s.update);

  const scaleOptions: { id: UiScale; label: string }[] = [
    { id: "small", label: t("settings.accessibility.uiScaleSmall") },
    { id: "default", label: t("settings.accessibility.uiScaleDefault") },
    { id: "large", label: t("settings.accessibility.uiScaleLarge") },
  ];

  return (
    <div>
      <PaneHeader
        title={t("settings.accessibility.title")}
        description={t("settings.accessibility.description")}
      />

      <Row
        label={t("settings.accessibility.uiScale")}
        hint={t("settings.accessibility.uiScaleHint")}
      >
        <Segmented
          value={uiScale}
          options={scaleOptions}
          onChange={(v) => update("accessibility", { uiScale: v })}
        />
      </Row>

      <Row
        label={t("settings.accessibility.screenReaderMode")}
        hint={t("settings.accessibility.screenReaderModeHint")}
      >
        <Switch
          checked={screenReaderMode}
          onChange={(value) => update("accessibility", { screenReaderMode: value })}
          ariaLabel={t("settings.accessibility.screenReaderMode")}
        />
      </Row>
    </div>
  );
}
