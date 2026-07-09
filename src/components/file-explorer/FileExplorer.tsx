import { useEffect } from "react";
import { FilePlus, FolderPlus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { Kbd } from "@/components/ui/Kbd";
import { useExplorerStore, type CreateKind } from "@/features/explorer/explorer.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { projectCapabilities } from "@/features/projects/project.types";
import { useSearchUiStore } from "@/features/search/search.store";
import { TreeNode, CreateRow, type TreeNodeActions } from "./TreeNode";
import { basename, dirname } from "@/lib/path";

interface FileExplorerProps extends TreeNodeActions {
  projectId: string;
  rootPath: string;
  rootName: string;
}

export function FileExplorer({
  projectId,
  rootPath,
  rootName,
  onOpenFile,
  onOpenInTerminal,
  onLaunchCliInPath,
}: FileExplorerProps) {
  const { t } = useTranslation();
  const loadIfNeeded = useExplorerStore((s) => s.loadIfNeeded);
  const refresh = useExplorerStore((s) => s.refresh);
  const beginCreate = useExplorerStore((s) => s.beginCreate);
  const setSelected = useExplorerStore((s) => s.setSelected);
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const canSearch = projectCapabilities(project).search;
  // Fine-grained: re-render the root list only when the root's children or the
  // inline-create state change, not on every mutation deeper in the tree.
  const rootChildren = useExplorerStore(
    (s) => s.byProject[projectId]?.children[rootPath],
  );
  const creating = useExplorerStore((s) => s.byProject[projectId]?.creating);

  // Load the root on first mount (or when project changes)
  useEffect(() => {
    void loadIfNeeded(projectId, rootPath);
  }, [projectId, rootPath, loadIfNeeded]);

  const creatingAtRoot = creating?.parentPath === rootPath;

  // Determine where a New File/Folder lands: inside the selected folder, the
  // parent of the selected file, or the project root when nothing is selected.
  const handleNewNode = (kind: CreateKind) => {
    const sel = useExplorerStore.getState().byProject[projectId]?.selected;
    let targetDir = rootPath;
    if (sel) targetDir = sel.isDir ? sel.path : dirname(sel.path);
    void beginCreate(projectId, targetDir, kind);
  };

  const headerButton = (
    label: string,
    onClick: () => void,
    icon: typeof FilePlus,
    shortcut?: React.ReactNode,
  ) => (
    <Tooltip content={label} shortcut={shortcut} side="bottom">
      <IconButton size="md" onClick={onClick} aria-label={label}>
        <Icon icon={icon} size={14} />
      </IconButton>
    </Tooltip>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[var(--panel-header-h)] shrink-0 items-center justify-between gap-[6px] px-[12px]">
        <span className="editorial-caps truncate" title={rootPath}>
          {rootName}
        </span>
        <div className="flex items-center gap-[2px]">
          {headerButton(t("explorer.newFile"), () => handleNewNode("file"), FilePlus)}
          {headerButton(t("explorer.newFolder"), () => handleNewNode("dir"), FolderPlus)}
          {canSearch
            ? headerButton(
                t("explorer.searchInProject"),
                () => useSearchUiStore.getState().setOpen(true),
                Search,
                <Kbd keys={["Mod", "Shift", "F"]} />,
              )
            : null}
        </div>
      </header>

      <nav
        className="flex-1 overflow-y-auto overflow-x-hidden py-[6px]"
        onClick={(e) => {
          // Clicking empty space clears selection (so New File/Folder targets root).
          if (e.target === e.currentTarget) setSelected(projectId, null);
        }}
      >
        {creatingAtRoot ? (
          <CreateRow
            projectId={projectId}
            parentPath={rootPath}
            kind={creating!.kind}
            depth={0}
            onOpenFile={onOpenFile}
          />
        ) : null}

        {rootChildren === undefined || rootChildren === "loading" ? (
          creatingAtRoot ? null : (
            <p className="px-[16px] py-[10px] font-mono text-label text-muted-soft">
              {t("common.loading")}
            </p>
          )
        ) : Array.isArray(rootChildren) ? (
          rootChildren.length === 0 ? (
            creatingAtRoot ? null : (
              <p className="px-[16px] py-[10px] font-mono text-label text-muted-soft">
                {t("explorer.emptyFolder")}
              </p>
            )
          ) : (
            rootChildren.map((c) => (
              <TreeNode
                key={c.path}
                projectId={projectId}
                entry={c}
                depth={0}
                onOpenFile={onOpenFile}
                onOpenInTerminal={onOpenInTerminal}
                onLaunchCliInPath={onLaunchCliInPath}
              />
            ))
          )
        ) : (
          <div className="px-[16px] py-[10px]">
            <p className="font-mono text-label text-danger">
              {t("explorer.couldNotReadFolder")}
            </p>
            <p className="mt-[2px] font-mono text-micro text-muted-soft" title={rootChildren.error}>
              {rootChildren.error.slice(0, 80)}
            </p>
            <button
              type="button"
              onClick={() => void refresh(projectId, rootPath)}
              className="mt-[8px] inline-flex h-[24px] items-center rounded-sm border border-hairline-strong px-[10px] text-caption text-ink hover:bg-surface-strong/40"
            >
              {t("common.retry")}
            </button>
          </div>
        )}
      </nav>
    </div>
  );
}

// Re-export basename so other modules can use it if helpful
export { basename };
