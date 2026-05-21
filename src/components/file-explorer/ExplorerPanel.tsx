import { FolderSearch } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { FileExplorer } from "./FileExplorer";

interface ExplorerPanelProps {
  hasProject: boolean;
  projectId?: string;
  projectName?: string;
  projectPath?: string;
  onOpenFolder: () => void;
  onOpenFile: (path: string, name: string) => void;
}

export function ExplorerPanel({
  hasProject,
  projectId,
  projectName,
  projectPath,
  onOpenFolder,
  onOpenFile,
}: ExplorerPanelProps) {
  return (
    <nav
      className="flex h-full w-full flex-col overflow-hidden border-r border-hairline bg-canvas"
      aria-label="File explorer"
    >
      {hasProject && projectId && projectPath ? (
        <FileExplorer
          projectId={projectId}
          rootPath={projectPath}
          rootName={projectName ?? ""}
          onOpenFile={onOpenFile}
        />
      ) : (
        <>
          <header className="flex h-[30px] shrink-0 items-center justify-between border-b border-hairline-soft px-[14px]">
            <span className="editorial-caps">Explorer</span>
          </header>
          <ExplorerEmpty onOpenFolder={onOpenFolder} />
        </>
      )}
    </nav>
  );
}

function ExplorerEmpty({ onOpenFolder }: { onOpenFolder: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-start gap-[12px] px-[16px] pt-[20px]">
      <div className="flex h-[28px] w-[28px] items-center justify-center rounded-sm border border-hairline text-muted">
        <Icon icon={FolderSearch} size={14} />
      </div>
      <div className="space-y-[4px]">
        <p className="text-[13px] font-medium text-ink">No project open</p>
        <p className="text-[12px] leading-[1.5] text-muted">
          Open a local folder to browse files. Your folders stay on disk &mdash; metacodex only stores
          workspace metadata.
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenFolder}
        className={cn(
          "mt-[4px] inline-flex h-[28px] items-center gap-[6px] rounded-sm border border-hairline-strong bg-canvas px-[12px] text-[12px] font-medium text-ink",
          "hover:bg-surface-strong/40 transition-colors",
        )}
      >
        Open Folder
      </button>
    </div>
  );
}
