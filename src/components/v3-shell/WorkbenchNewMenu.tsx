import { File, FolderOpen, GitCompare, Globe, Plus } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import { useCommandPaletteStore } from "@/features/command-palette/command-palette.store";
import type { RightWorkbenchTab } from "@/features/side-panel/sidePanel.store";

const SURFACES: {
  id: RightWorkbenchTab;
  icon: typeof GitCompare;
  labelKey: string;
}[] = [
  { id: "changes", icon: GitCompare, labelKey: "v3.workbench.changes" },
  { id: "files", icon: FolderOpen, labelKey: "v3.workbench.files" },
  { id: "browser", icon: Globe, labelKey: "v3.workbench.browser" },
];

interface WorkbenchNewMenuProps {
  onOpen: (tab: RightWorkbenchTab) => void;
}

export function WorkbenchNewMenu({ onOpen }: WorkbenchNewMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownRoot>
      <Tooltip content={t("v3.workbench.newTab")} side="bottom">
        <DropdownTrigger asChild>
          <button
            type="button"
            data-no-drag
            className={cn(
              "press-feedback inline-flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-md text-muted",
              "transition-colors duration-fast",
              "hover:bg-surface-strong hover:text-ink",
              "data-[state=open]:bg-surface-strong data-[state=open]:text-ink",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
            )}
            aria-label={t("v3.workbench.newTab")}
          >
            <Icon icon={Plus} size={12} />
          </button>
        </DropdownTrigger>
      </Tooltip>
      <DropdownContent align="start" sideOffset={6} className="min-w-[228px]">
        <DropdownItem
          onSelect={() => useCommandPaletteStore.getState().openFiles()}
          trailing={<Kbd keys={["Mod", "P"]} />}
        >
          <Icon icon={File} size={12} className="text-muted" />
          <span>{t("tabs.openFile")}</span>
        </DropdownItem>
        <DropdownSeparator />
        {SURFACES.map((item) => (
          <DropdownItem
            key={item.id}
            onSelect={() => onOpen(item.id)}
            trailing={item.id === "browser" ? <Kbd keys={["Mod", "Shift", "B"]} /> : undefined}
          >
            <Icon icon={item.icon} size={12} className="text-muted" />
            <span>{t(item.labelKey)}</span>
          </DropdownItem>
        ))}
      </DropdownContent>
    </DropdownRoot>
  );
}

export function surfaceIcon(id: RightWorkbenchTab): typeof GitCompare {
  return SURFACES.find((item) => item.id === id)?.icon ?? GitCompare;
}

export function surfaceLabelKey(id: RightWorkbenchTab): string {
  return SURFACES.find((item) => item.id === id)?.labelKey ?? "v3.workbench.changes";
}
