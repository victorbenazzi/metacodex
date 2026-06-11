import { FolderSearch } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { FileExplorer } from "./FileExplorer";
import type { TreeNodeActions } from "./TreeNode";

interface ExplorerPanelProps extends TreeNodeActions {
  hasProject: boolean;
  projectId?: string;
  projectName?: string;
  projectPath?: string;
  onOpenFolder: () => void;
}

export function ExplorerPanel({
  hasProject,
  projectId,
  projectName,
  projectPath,
  onOpenFolder,
  onOpenFile,
  onRequestDelete,
  onRename,
  onOpenInTerminal,
  onLaunchCliInPath,
  onMove,
}: ExplorerPanelProps) {
  const { t } = useTranslation();
  return (
    <nav
      className="flex h-full w-full flex-col overflow-hidden border-r border-hairline bg-canvas"
      aria-label={t("explorer.ariaLabel")}
    >
      {hasProject && projectId && projectPath ? (
        <FileExplorer
          projectId={projectId}
          rootPath={projectPath}
          rootName={projectName ?? ""}
          onOpenFile={onOpenFile}
          onRequestDelete={onRequestDelete}
          onRename={onRename}
          onOpenInTerminal={onOpenInTerminal}
          onLaunchCliInPath={onLaunchCliInPath}
          onMove={onMove}
        />
      ) : (
        <>
          <header className="flex h-[30px] shrink-0 items-center justify-between border-b border-hairline-soft px-[14px]">
            <span className="editorial-caps">{t("explorer.title")}</span>
          </header>
          <ExplorerEmpty onOpenFolder={onOpenFolder} />
        </>
      )}
    </nav>
  );
}

function ExplorerEmpty({ onOpenFolder }: { onOpenFolder: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-start gap-[12px] px-[16px] pt-[20px]">
      <div className="flex h-[28px] w-[28px] items-center justify-center rounded-sm border border-hairline text-muted">
        <Icon icon={FolderSearch} size={14} />
      </div>
      <div className="space-y-[4px]">
        <p className="text-ui font-medium text-ink">{t("explorer.noProject")}</p>
        <p className="text-caption leading-[1.5] text-muted">
          {t("explorer.noProjectBody")}
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenFolder}
        className={cn(
          "mt-[4px] inline-flex h-[28px] items-center gap-[6px] rounded-sm border border-hairline-strong bg-canvas px-[12px] text-caption font-medium text-ink",
          "hover:bg-surface-strong/40 transition-colors",
        )}
      >
        {t("explorer.openFolder")}
      </button>
    </div>
  );
}
