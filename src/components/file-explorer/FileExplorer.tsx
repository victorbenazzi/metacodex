import { useEffect } from "react";
import { RefreshCw, Search } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { Kbd } from "@/components/ui/Kbd";
import { useExplorerStore } from "@/features/explorer/explorer.store";
import { useSearchUiStore } from "@/features/search/search.store";
import { TreeNode } from "./TreeNode";
import { basename } from "@/lib/path";
import { cn } from "@/lib/cn";

interface FileExplorerProps {
  projectId: string;
  rootPath: string;
  rootName: string;
  onOpenFile: (path: string, name: string) => void;
}

export function FileExplorer({ projectId, rootPath, rootName, onOpenFile }: FileExplorerProps) {
  const bucket = useExplorerStore((s) => s.byProject[projectId]);
  const loadIfNeeded = useExplorerStore((s) => s.loadIfNeeded);
  const refresh = useExplorerStore((s) => s.refresh);

  // Load the root on first mount (or when project changes)
  useEffect(() => {
    void loadIfNeeded(projectId, rootPath);
  }, [projectId, rootPath, loadIfNeeded]);

  const rootChildren = bucket?.children[rootPath];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[30px] shrink-0 items-center justify-between gap-[6px] border-b border-hairline-soft px-[12px]">
        <span className="editorial-caps truncate" title={rootPath}>
          {rootName}
        </span>
        <div className="flex items-center gap-[2px]">
          <Tooltip content="Search in project" shortcut={<Kbd keys={["Mod", "Shift", "F"]} />} side="bottom">
            <button
              type="button"
              onClick={() => useSearchUiStore.getState().setOpen(true)}
              className={cn(
                "inline-flex h-[22px] w-[22px] items-center justify-center rounded-xs",
                "text-muted hover:bg-surface-strong/55 hover:text-ink",
              )}
              aria-label="Search in project"
            >
              <Icon icon={Search} size={11} />
            </button>
          </Tooltip>
          <Tooltip content="Refresh" side="bottom">
            <button
              type="button"
              onClick={() => void refresh(projectId, rootPath)}
              className={cn(
                "inline-flex h-[22px] w-[22px] items-center justify-center rounded-xs",
                "text-muted hover:bg-surface-strong/55 hover:text-ink",
              )}
              aria-label="Refresh"
            >
              <Icon icon={RefreshCw} size={11} />
            </button>
          </Tooltip>
        </div>
      </header>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-[6px]">
        {rootChildren === undefined || rootChildren === "loading" ? (
          <p className="px-[16px] py-[10px] font-mono text-[11px] text-muted-soft">
            loading…
          </p>
        ) : Array.isArray(rootChildren) ? (
          rootChildren.length === 0 ? (
            <p className="px-[16px] py-[10px] font-mono text-[11px] italic text-muted-soft">
              (empty folder)
            </p>
          ) : (
            rootChildren.map((c) => (
              <TreeNode
                key={c.path}
                projectId={projectId}
                entry={c}
                depth={0}
                onOpenFile={onOpenFile}
              />
            ))
          )
        ) : (
          <div className="px-[16px] py-[10px]">
            <p className="font-mono text-[11px] text-danger">
              could not read folder
            </p>
            <p className="mt-[2px] font-mono text-[10px] text-muted-soft" title={rootChildren.error}>
              {rootChildren.error.slice(0, 80)}
            </p>
            <button
              type="button"
              onClick={() => void refresh(projectId, rootPath)}
              className="mt-[8px] inline-flex h-[24px] items-center rounded-sm border border-hairline-strong px-[10px] text-[12px] text-ink hover:bg-surface-strong/40"
            >
              Retry
            </button>
          </div>
        )}
      </nav>
    </div>
  );
}

// Re-export basename so other modules can use it if helpful
export { basename };
