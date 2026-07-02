import { useTranslation } from "react-i18next";
import { Laptop, Moon, Sun, type LucideIcon } from "lucide-react";

import { Segmented } from "@/components/ui/Segmented";
import { ThemePicker } from "@/components/settings/ThemePicker";
import { PaneHeader, Row } from "@/components/settings/SettingsPrimitives";
import { useThemeStore, type ThemeMode } from "@/features/theme/theme.store";

export function AppearancePane() {
  const { t } = useTranslation();
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  const options: { id: ThemeMode; label: string; icon: LucideIcon }[] = [
    { id: "system", label: t("settings.appearance.system"), icon: Laptop },
    { id: "light", label: t("settings.appearance.light"), icon: Sun },
    { id: "dark", label: t("settings.appearance.dark"), icon: Moon },
  ];

  return (
    <div>
      <PaneHeader title={t("settings.appearance.title")} description={t("settings.appearance.description")} />

      <Row label={t("settings.appearance.mode")} hint={t("settings.appearance.modeHint")}>
        <Segmented value={mode} options={options} onChange={setMode} />
      </Row>

      <div className="pt-[20px]">
        <ThemePicker />
      </div>
    </div>
  );
}
