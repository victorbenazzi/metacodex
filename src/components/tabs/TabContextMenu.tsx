import { type ReactNode } from "react";
import * as RCM from "@radix-ui/react-context-menu";
import {
  X,
  XSquare,
  Copy,
  FolderOpen,
  Square,
  CornerDownLeft,
  Pencil,
  RotateCcw,
} from "@/components/ui/icons";
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
  /** Enter inline rename mode. Provide only for terminal/cli tabs. */
  onRename?: () => void;
  /** Clear the user-set title. Provide only when `tab.userTitle` is set. */
  onResetTitle?: () => void;
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
  onRename,
  onResetTitle,
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
        // menu refers to. Matches VS Code / Linear behavior.
        if (open && !isActive) onSelect?.();
      }}
    >
      <RCM.Trigger asChild>{children}</RCM.Trigger>
      <ContextMenuContent>
        {onRename ? (
          <>
            <ContextMenuItem
              onSelect={onRename}
              trailing={isActive ? <Kbd keys={["F2"]} /> : null}
            >
              <Icon icon={Pencil} size={12} className="text-muted" />
              {t("tabs.rename")}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}

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

        {onResetTitle ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onResetTitle}>
              <Icon icon={RotateCcw} size={12} className="text-muted" />
              {t("tabs.resetTitle")}
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
