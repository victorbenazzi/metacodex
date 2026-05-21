import { memo, useCallback } from "react";

import { ChevronIcon, FileIcon } from "./FileIcon";
import { useExplorerStore, type ChildrenState } from "@/features/explorer/explorer.store";
import { useGitStore } from "@/features/git/git.store";
import { cn } from "@/lib/cn";
import type { DirEntry } from "@/features/filesystem/filesystem.types";

interface TreeNodeProps {
  projectId: string;
  entry: DirEntry;
  depth: number;
  onOpenFile: (path: string, name: string) => void;
}

export const TreeNode = memo(function TreeNode({
  projectId,
  entry,
  depth,
  onOpenFile,
}: TreeNodeProps) {
  const bucket = useExplorerStore((s) => s.byProject[entry ? projectId : "_"]);
  const expandedSet = bucket?.expanded;
  const isOpen = expandedSet?.has(entry.path) ?? false;
  const children: ChildrenState | undefined = bucket?.children[entry.path];
  const toggle = useExplorerStore((s) => s.toggleExpand);
  const gitStatus = useGitStore((s) => s.byProject[projectId]?.statuses?.[entry.path]);

  const indentPx = depth * 12 + 8;

  const handleClick = useCallback(() => {
    if (entry.isDir) {
      void toggle(projectId, entry.path);
    } else {
      onOpenFile(entry.path, entry.name);
    }
  }, [entry, projectId, toggle, onOpenFile]);

  const hidden = entry.name.startsWith(".");

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "group flex w-full items-center gap-[6px] py-[3px] text-left font-mono text-[12px]",
          "hover:bg-surface-strong/45 focus-visible:outline-none focus-visible:bg-surface-strong/55",
          hidden ? "text-muted" : "text-body",
        )}
        style={{ paddingLeft: indentPx }}
        title={entry.path}
      >
        {entry.isDir ? <ChevronIcon open={isOpen} /> : <span className="w-[11px] shrink-0" />}
        <FileIcon
          isDir={entry.isDir}
          isOpen={isOpen}
          filename={entry.name}
          className={entry.isDir ? "text-muted" : "text-muted-soft"}
        />
        <span className={cn("truncate", gitColorForName(gitStatus))}>{entry.name}</span>
        <span className="ml-auto flex items-center gap-[6px] pr-[8px]">
          {entry.isSymlink ? <span className="text-[10px] text-muted-soft">↗</span> : null}
          {gitStatus ? (
            <span className={cn("font-mono text-[10px]", gitColorForBadge(gitStatus))}>{gitStatus}</span>
          ) : null}
        </span>
      </button>

      {entry.isDir && isOpen ? (
        <TreeChildren
          projectId={projectId}
          path={entry.path}
          depth={depth + 1}
          state={children}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </>
  );
});

interface TreeChildrenProps {
  projectId: string;
  path: string;
  depth: number;
  state: ChildrenState | undefined;
  onOpenFile: (path: string, name: string) => void;
}

function TreeChildren({ projectId, path, depth, state, onOpenFile }: TreeChildrenProps) {
  const indentPx = depth * 12 + 8;
  if (state === undefined || state === "loading") {
    return (
      <div
        className="flex items-center gap-[6px] py-[3px] font-mono text-[11px] text-muted-soft"
        style={{ paddingLeft: indentPx }}
      >
        <span className="h-[8px] w-[8px] animate-pulse rounded-full bg-hairline-strong" />
        loading…
      </div>
    );
  }
  if (Array.isArray(state)) {
    if (state.length === 0) {
      return (
        <div
          className="py-[3px] font-mono text-[11px] italic text-muted-soft"
          style={{ paddingLeft: indentPx }}
        >
          (empty)
        </div>
      );
    }
    return (
      <>
        {state.map((c) => (
          <TreeNode
            key={c.path}
            projectId={projectId}
            entry={c}
            depth={depth}
            onOpenFile={onOpenFile}
          />
        ))}
      </>
    );
  }
  // Error state
  return (
    <div
      className="py-[3px] font-mono text-[11px] text-danger"
      style={{ paddingLeft: indentPx }}
      title={state.error}
    >
      could not read · <em>{state.error.slice(0, 60)}</em>
    </div>
  );
  void path;
}

function gitColorForName(status?: string): string {
  if (!status) return "text-ink/85";
  if (status === "M" || status === "T") return "text-warn";
  if (status === "A") return "text-success";
  if (status === "?") return "text-success/85";
  if (status === "D") return "text-danger/85";
  if (status === "!") return "text-danger";
  return "text-ink/85";
}

function gitColorForBadge(status: string): string {
  if (status === "M" || status === "T") return "text-warn";
  if (status === "A") return "text-success";
  if (status === "?") return "text-success/70";
  if (status === "D") return "text-danger/85";
  if (status === "!") return "text-danger";
  return "text-muted";
}
