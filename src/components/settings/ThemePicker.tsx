import { useTranslation } from "react-i18next";

import { useThemeStore } from "@/features/theme/theme.store";
import { THEMES } from "@/features/theme/themes";

import { ThemeCard } from "./ThemeCard";

/** Grid of theme cards. Clicking a card swaps the whole palette live and
 *  syncs the Mode toggle to the new theme's kind. */
export function ThemePicker() {
  const { t } = useTranslation();
  const activeId = useThemeStore((s) => s.theme.id);
  const setThemeId = useThemeStore((s) => s.setThemeId);

  return (
    <div>
      <div className="mb-[10px] flex items-center justify-between">
        <span className="text-caption font-medium text-ink">
          {t("settings.appearance.themeGallery")}
        </span>
        <span className="text-label text-muted">
          {t("settings.appearance.themeCount", { count: THEMES.length })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-[12px]">
        {THEMES.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            selected={theme.id === activeId}
            onSelect={() => setThemeId(theme.id)}
          />
        ))}
      </div>
    </div>
  );
}
