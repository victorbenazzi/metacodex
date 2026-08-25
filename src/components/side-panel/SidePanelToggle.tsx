import { PanelRightClose, PanelRightOpen } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { useSidePanelStore } from "@/features/side-panel/sidePanel.store";
import { cn } from "@/lib/cn";

export function SidePanelToggle() {
  const { t } = useTranslation();
  const open = useSidePanelStore((s) => s.view !== "closed");
  const toggle = useSidePanelStore((s) => s.toggle);

  return (
    <Tooltip content={t("sidePanel.toggle")} side="bottom">
      <button
        type="button"
        onClick={() => toggle()}
        aria-label={t("sidePanel.toggle")}
        aria-pressed={open}
        className={cn(
          "inline-flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-fast",
          "hover:bg-surface-strong hover:text-ink",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
          open && "bg-surface-strong text-ink",
        )}
      >
        <Icon icon={open ? PanelRightClose : PanelRightOpen} size={14} />
      </button>
    </Tooltip>
  );
}
