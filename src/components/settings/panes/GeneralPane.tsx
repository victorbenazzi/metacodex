import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { SUPPORTED_LANGUAGES } from "@/features/i18n/config";
import { PaneHeader, Row } from "@/components/settings/SettingsPrimitives";

export function GeneralPane() {
  const { t, i18n } = useTranslation();

  return (
    <div>
      <PaneHeader title={t("settings.general.title")} description={t("settings.general.description")} />

      <Row label={t("settings.general.language")} hint={t("settings.general.languageHint")}>
        <div className="flex gap-[6px]">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = i18n.language === lang.id;
            return (
              <button
                key={lang.id}
                type="button"
                onClick={() => void i18n.changeLanguage(lang.id)}
                className={cn(
                  "inline-flex h-[30px] items-center rounded-sm border px-[12px] text-caption transition-colors",
                  active
                    ? "border-ink bg-ink text-on-primary"
                    : "border-hairline-strong text-ink hover:bg-surface-strong/45",
                )}
                aria-pressed={active}
              >
                {lang.native}
              </button>
            );
          })}
        </div>
      </Row>

      <Row label={t("settings.general.projectStorage")} hint={t("settings.general.projectStorageHint")}>
        <span className="font-mono text-label text-muted">~/.metacodex</span>
      </Row>

      <Row label={t("settings.general.saveWorkspace")} hint={t("settings.general.saveWorkspaceHint")}>
        <Badge>{t("settings.general.alwaysOn")}</Badge>
      </Row>

      <Row label={t("settings.general.restoreTerminals")} hint={t("settings.general.restoreTerminalsHint")}>
        <Badge>{t("settings.general.off")}</Badge>
      </Row>
    </div>
  );
}
