import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { useSidePanelStore } from "@/features/side-panel/sidePanel.store";
import { cn } from "@/lib/cn";

export function SidePanelToggle() {
  const { t } = useTranslation();
  const open = useSidePanelStore((s) => s.open);
  const toggle = useSidePanelStore((s) => s.toggle);

  return (
    <Tooltip content={t("sidePanel.toggle")} side="bottom">
      <button
        type="button"
        onClick={() => toggle()}
        aria-label={t("sidePanel.toggle")}
        aria-pressed={open}
        className={cn(
          "inline-flex h-[24px] w-[24px] items-center justify-center rounded-sm text-muted transition-colors duration-fast",
          "hover:bg-surface-strong/55 hover:text-ink",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
          open && "bg-surface-strong/70 text-ink",
        )}
      >
        <Icon icon={open ? PanelRightClose : PanelRightOpen} size={15} />
      </button>
    </Tooltip>
  );
}
