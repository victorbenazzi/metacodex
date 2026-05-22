import { type ReactNode } from "react";
import * as RCM from "@radix-ui/react-context-menu";
import {
  X,
  XSquare,
  Copy,
  FolderOpen,
  Square,
  CornerDownLeft,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuSeparator,
} from "@/components/ui/ContextMenu";
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import type { Tab } from "./types";

interface TabContextMenuProps {
  tab: Tab;
  totalTabs: number;
  isActive: boolean;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onCopyPath?: () => void;
  onRevealInFinder?: () => void;
  onCopyCwd?: () => void;
  onSelect?: () => void;
  children: ReactNode;
}

export function TabContextMenu({
  tab,
  totalTabs,
  isActive,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCopyPath,
  onRevealInFinder,
  onCopyCwd,
  onSelect,
  children,
}: TabContextMenuProps) {
  const { t } = useTranslation();
  const isProcess = tab.kind === "terminal" || tab.kind === "cli";
  const isFile =
    tab.kind === "editor" ||
    tab.kind === "markdown" ||
    tab.kind === "image" ||
    tab.kind === "pdf";

  return (
    <ContextMenuRoot
      onOpenChange={(open) => {
        // Promote tab to active on right-click so the user sees which tab the
        // menu refers to — matches VS Code / Linear behavior.
        if (open && !isActive) onSelect?.();
      }}
    >
      <RCM.Trigger asChild>{children}</RCM.Trigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={onClose}
          trailing={isActive ? <Kbd keys={["Mod", "W"]} /> : null}
        >
          <Icon icon={X} size={12} className="text-muted" />
          {t("tabs.close")}
        </ContextMenuItem>

        {totalTabs > 1 ? (
          <>
            <ContextMenuItem onSelect={onCloseOthers}>
              <Icon icon={Square} size={12} className="text-muted" />
              {t("tabs.closeOthers")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={onCloseAll}>
              <Icon icon={XSquare} size={12} className="text-muted" />
              {t("tabs.closeAll")}
            </ContextMenuItem>
          </>
        ) : null}

        {isFile && (onCopyPath || onRevealInFinder) ? (
          <>
            <ContextMenuSeparator />
            {onCopyPath ? (
              <ContextMenuItem onSelect={onCopyPath}>
                <Icon icon={Copy} size={12} className="text-muted" />
                {t("tabs.copyPath")}
              </ContextMenuItem>
            ) : null}
            {onRevealInFinder ? (
              <ContextMenuItem onSelect={onRevealInFinder}>
                <Icon icon={FolderOpen} size={12} className="text-muted" />
                {t("tabs.revealInFinder")}
              </ContextMenuItem>
            ) : null}
          </>
        ) : null}

        {isProcess && onCopyCwd ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onCopyCwd}>
              <Icon icon={CornerDownLeft} size={12} className="text-muted" />
              {t("tabs.copyCwd")}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
