import { ChevronDown, X } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import {
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownRoot,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";
import { resolveTabTitle, type Tab } from "./types";
import { renderTabIcon } from "./tabChrome";

interface TabOverflowMenuProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function TabOverflowMenu({
  tabs,
  activeTabId,
  onSelect,
  onClose,
}: TabOverflowMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownRoot>
      <DropdownTrigger asChild>
        <IconButton
          size="sm"
          data-no-drag
          className="h-[22px] w-[22px]"
          aria-label={t("tabs.overflowTabs")}
        >
          <Icon icon={ChevronDown} size={12} />
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" sideOffset={8} className="w-[260px] max-h-[min(420px,70vh)] overflow-y-auto">
        <DropdownLabel>{t("tabs.overflowTabs")}</DropdownLabel>
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const title =
            tab.kind === "changes" ? t("v3.workbench.changes") : resolveTabTitle(tab);
          return (
            <div key={tab.id} className="flex items-center gap-2px pr-2px">
              <DropdownItem
                onSelect={() => onSelect(tab.id)}
                className={cn("min-w-0 flex-1", active && "bg-surface-strong/55")}
              >
                {renderTabIcon(tab, active)}
                <span className="min-w-0 truncate">{title}</span>
              </DropdownItem>
              <IconButton
                size="sm"
                data-no-drag
                aria-label={t("tabs.closeTab")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <Icon icon={X} size={12} />
              </IconButton>
            </div>
          );
        })}
      </DropdownContent>
    </DropdownRoot>
  );
}
