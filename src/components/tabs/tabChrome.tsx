import type { ReactNode } from "react";
import { TerminalSquare, GitCompare } from "@/components/ui/icons";

import { Icon } from "@/components/ui/Icon";
import { FileIcon } from "@/components/file-explorer/FileIcon";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import type { Tab } from "./types";

export function renderTabIcon(tab: Tab, active: boolean): ReactNode {
  const tone = active ? "text-tab-active-text" : "text-muted-soft";

  if (tab.kind === "terminal") {
    return <Icon icon={TerminalSquare} size={12} className={tone} />;
  }
  if (tab.kind === "cli") {
    const BrandIcon = CLI_BRAND_ICONS[tab.cliId];
    if (BrandIcon) {
      return (
        <span className="inline-flex h-[12px] w-[12px] shrink-0 items-center justify-center">
          <BrandIcon size={12} />
        </span>
      );
    }
    return <Icon icon={TerminalSquare} size={12} className={tone} />;
  }
  if (tab.kind === "diff") {
    return <Icon icon={GitCompare} size={12} className={tone} />;
  }
  if (tab.kind === "editor" || tab.kind === "markdown" || tab.kind === "image" || tab.kind === "pdf") {
    return (
      <FileIcon isDir={false} filename={tab.path} size={12} className={tone} />
    );
  }
  return <Icon icon={TerminalSquare} size={12} className={tone} />;
}
