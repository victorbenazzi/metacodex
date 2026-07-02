import { useTranslation } from "react-i18next";

import { Switch } from "@/components/ui/Switch";
import { PaneHeader, Row } from "@/components/settings/SettingsPrimitives";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";

export function NotificationsPane() {
  const { t } = useTranslation();
  const notifications = useSettingsDataStore((s) => s.settings.notifications);
  const update = useSettingsDataStore((s) => s.update);

  return (
    <div>
      <PaneHeader
        title={t("settings.notifications.title")}
        description={t("settings.notifications.description")}
      />

      <Row
        label={t("settings.notifications.osNotifications")}
        hint={t("settings.notifications.osNotificationsHint")}
      >
        <Switch
          checked={notifications.osNotificationsEnabled}
          onChange={(v) => update("notifications", { osNotificationsEnabled: v })}
          ariaLabel={t("settings.notifications.osNotifications")}
        />
      </Row>

      <Row
        label={t("settings.notifications.sound")}
        hint={t("settings.notifications.soundHint")}
      >
        <Switch
          checked={notifications.soundEnabled}
          onChange={(v) => update("notifications", { soundEnabled: v })}
          ariaLabel={t("settings.notifications.sound")}
        />
      </Row>

      <Row
        label={t("settings.notifications.notifyWhenFocused")}
        hint={t("settings.notifications.notifyWhenFocusedHint")}
      >
        <Switch
          checked={notifications.notifyWhenFocused}
          onChange={(v) => update("notifications", { notifyWhenFocused: v })}
          ariaLabel={t("settings.notifications.notifyWhenFocused")}
        />
      </Row>
    </div>
  );
}
