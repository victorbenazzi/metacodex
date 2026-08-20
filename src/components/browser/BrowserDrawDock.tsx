import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ImagePlus, RotateCcw, X } from "@/components/ui/icons";

/** Reserved strip so the native webview does not cover the dock. */
export const BROWSER_DRAW_DOCK_H = 52;

export function BrowserDrawDock({
  onSend,
  onClear,
  onCancel,
}: {
  onSend: () => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex justify-center pb-10px"
      style={{ height: BROWSER_DRAW_DOCK_H }}
    >
      <div
        className="pointer-events-auto flex shrink-0 items-center gap-6px whitespace-nowrap rounded-lg border border-hairline bg-surface-card px-8px py-6px shadow-elevated"
        role="toolbar"
        aria-label={t("browser.drawDock")}
      >
        <Button size="sm" variant="ghost" onClick={onClear}>
          <Icon icon={RotateCcw} size={12} className="text-muted" />
          {t("browser.drawClear")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <Icon icon={X} size={12} className="text-muted" />
          {t("browser.drawCancel")}
        </Button>
        <Button size="sm" variant="primary" onClick={onSend}>
          <Icon icon={ImagePlus} size={12} />
          {t("browser.drawSend")}
        </Button>
      </div>
    </div>
  );
}
