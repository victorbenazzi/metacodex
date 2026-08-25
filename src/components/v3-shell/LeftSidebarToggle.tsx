import { PanelLeftClose, PanelLeftOpen } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { useCodeSidebarStore } from "@/features/ui/codeSidebar.store";
import { cn } from "@/lib/cn";

export function LeftSidebarToggle() {
  const { t } = useTranslation();
  const open = !useCodeSidebarStore((s) => s.collapsed);
  const toggle = useCodeSidebarStore((s) => s.toggleCollapsed);
  const label = open ? t("codeSidebar.collapse") : t("codeSidebar.expand");

  return (
    <Tooltip content={label} side="bottom" align="start">
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-pressed={open}
        className={cn(
          "inline-flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-md text-ink transition-colors duration-fast",
          "hover:bg-surface-strong",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
        )}
      >
        <Icon icon={open ? PanelLeftClose : PanelLeftOpen} size={14} />
      </button>
    </Tooltip>
  );
}
