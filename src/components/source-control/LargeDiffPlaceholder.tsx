import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";

export function LargeDiffPlaceholder({ onLoad }: { onLoad: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-12px px-24px py-32px text-center">
      <p className="text-ui text-muted">{t("sourceControl.largeDiffHidden")}</p>
      <Button variant="subtle" size="sm" onClick={onLoad}>
        {t("sourceControl.loadDiff")}
      </Button>
    </div>
  );
}
