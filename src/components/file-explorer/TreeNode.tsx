import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  FolderOpen,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { ChevronIcon, FileIcon } from "./FileIcon";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuTrigger,
} from "@/components/ui/ContextMenu";
import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  useExplorerStore,
  type ChildrenState,
  type CreateKind,
} from "@/features/explorer/explorer.store";
import { useGitStore } from "@/features/git/git.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { projectCapabilities } from "@/features/projects/project.types";
import {
  gitColorForBadge,
  gitColorForName,
  gitStatusLabelKey,
} from "@/features/git/gitStatus";
import { DEFAULT_CLI_REGISTRY, type CliTool } from "@/features/terminal/cli-registry";
import { cn } from "@/lib/cn";
import { CMD, invoke } from "@/lib/ipc";
import { basename } from "@/lib/path";
import type { DirEntry } from "@/features/filesystem/filesystem.types";

export interface TreeNodeActions {
  onOpenFile: (path: string, name: string, openInEditMode?: boolean) => void;
  onOpenInTerminal: (path: string, name: string) => void;
  onLaunchCliInPath: (cli: CliTool, path: string, name: string) => void;
}

interface TreeNodeProps extends TreeNodeActions {
  projectId: string;
  entry: DirEntry;
  depth: number;
}

export const TreeNode = memo(function TreeNode({
  projectId,
  entry,
  depth,
  onOpenFile,
  onOpenInTerminal,
  onLaunchCliInPath,
}: TreeNodeProps) {
  const { t } = useTranslation();
  // Fine-grained subscriptions: each TreeNode re-renders only when *its own*
  // expanded / children / selection / recent state changes. Subscribing to the
  // whole bucket made every node in the tree re-render on every watcher
  // refresh, which is a big part of what made the explorer feel sluggish while
  // an agent wrote a burst of files.
  const isOpen = useExplorerStore(
    (s) => s.byProject[projectId]?.expanded.has(entry.path) ?? false,
  );
  const children: ChildrenState | undefined = useExplorerStore(
    (s) => s.byProject[projectId]?.children[entry.path],
  );
  const isSelected = useExplorerStore(
    (s) => s.byProject[projectId]?.selected?.path === entry.path,
  );
  // Tint entries that appeared on disk in the last few seconds (created by the
  // IA in a terminal tab, by another process, or via inline-create). The
  // animation drives both the held tint and the final fade-out.
  const isRecent = useExplorerStore(
    (s) => s.byProject[projectId]?.recentlyAdded?.[entry.path] !== undefined,
  );
  const toggle = useExplorerStore((s) => s.toggleExpand);
  const setSelected = useExplorerStore((s) => s.setSelected);
  const gitStatus = useGitStore((s) => s.byProject[projectId]?.statuses?.[entry.path]);
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const canReveal = projectCapabilities(project).revealInFinder;

  const indentPx = depth * 12 + 8;

  const handleClick = useCallback(() => {
    setSelected(projectId, { path: entry.path, isDir: entry.isDir });
    if (entry.isDir) {
      void toggle(projectId, entry.path);
    } else {
      onOpenFile(entry.path, entry.name);
    }
  }, [entry, projectId, toggle, onOpenFile, setSelected]);

  const copyPath = useCallback(() => {
    navigator.clipboard.writeText(entry.path).catch((err) => {
      console.warn("[clipboard] copy failed", err);
    });
  }, [entry.path]);

  const revealInFinder = useCallback(() => {
    invoke(CMD.revealInFinder, { path: entry.path }).catch((err) => {
      console.warn("[reveal_in_finder] failed", err);
    });
  }, [entry.path]);

  const hidden = entry.name.startsWith(".");

  const row = (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "group flex w-full items-center gap-[8px] py-[3px] text-left font-mono text-mono",
            "focus-visible:outline-none",
            hidden ? "text-muted" : "text-body",
            isSelected
              ? "bg-accent/15 hover:bg-accent/20"
              : "hover:bg-surface-strong/45 focus-visible:bg-surface-strong/55",
            "data-[state=open]:bg-surface-strong/55",
            // Recent-file tint runs underneath the selection/hover layers
            // and overrides them visually for ~14.4s before fading out.
            isRecent && !isSelected && "animate-explorer-recent-tint",
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
            {entry.isSymlink ? <span className="text-micro text-muted-soft">↗</span> : null}
            {gitStatus ? (
              <Tooltip content={t(gitStatusLabelKey(gitStatus))} side="left">
                <span
                  className={cn(
                    "inline-flex h-[14px] min-w-[12px] items-center justify-center font-mono text-micro leading-none",
                    gitColorForBadge(gitStatus),
                  )}
                  // Hovering only this glyph reveals the status meaning , the
                  // surrounding row stays a plain click target.
                  onClick={(e) => e.stopPropagation()}
                >
                  {gitStatus}
                </span>
              </Tooltip>
            ) : null}
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {entry.isDir ? (
          <>
            <ContextMenuItem onSelect={() => onOpenInTerminal(entry.path, entry.name)}>
              <Icon icon={SquareTerminal} size={12} className="text-muted" />
              {t("tree.openInTerminal")}
            </ContextMenuItem>
            <ContextMenuSub
              trigger={
                <>
                  <Icon icon={Sparkles} size={12} className="text-muted" />
                  {t("tree.openCliHere")}
                </>
              }
            >
              {DEFAULT_CLI_REGISTRY.map((cli) => (
                <ContextMenuItem
                  key={cli.id}
                  onSelect={() => onLaunchCliInPath(cli, entry.path, entry.name)}
                >
                  {cli.label}
                </ContextMenuItem>
              ))}
            </ContextMenuSub>
            {canReveal ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={revealInFinder}>
                  <Icon icon={FolderOpen} size={12} className="text-muted" />
                  {t("tree.revealInFinder")}
                </ContextMenuItem>
              </>
            ) : null}
            <ContextMenuItem onSelect={copyPath}>
              <Icon icon={Copy} size={12} className="text-muted" />
              {t("tree.copyPath")}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => onOpenFile(entry.path, entry.name)}>
              <Icon icon={FolderOpen} size={12} className="text-muted" />
              {t("tree.open")}
            </ContextMenuItem>
            {canReveal ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={revealInFinder}>
                  <Icon icon={FolderOpen} size={12} className="text-muted" />
                  {t("tree.revealInFinder")}
                </ContextMenuItem>
              </>
            ) : null}
            <ContextMenuItem onSelect={copyPath}>
              <Icon icon={Copy} size={12} className="text-muted" />
              {t("tree.copyPath")}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenuRoot>
  );

  return (
    <>
      {row}
      {entry.isDir && isOpen ? (
        <TreeChildren
          projectId={projectId}
          path={entry.path}
          depth={depth + 1}
          state={children}
          onOpenFile={onOpenFile}
          onOpenInTerminal={onOpenInTerminal}
          onLaunchCliInPath={onLaunchCliInPath}
        />
      ) : null}
    </>
  );
});

/** Inline input for creating a new file/folder inside `parentPath`. */
export function CreateRow({
  projectId,
  parentPath,
  kind,
  depth,
  onOpenFile,
}: {
  projectId: string;
  parentPath: string;
  kind: CreateKind;
  depth: number;
  onOpenFile: (path: string, name: string, openInEditMode?: boolean) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const committingRef = useRef(false);
  const createNode = useExplorerStore((s) => s.createNode);
  const cancelCreate = useExplorerStore((s) => s.cancelCreate);

  const indentPx = depth * 12 + 8;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = useCallback(async () => {
    if (committingRef.current) return;
    const name = value.trim();
    if (!name) {
      cancelCreate(projectId);
      return;
    }
    committingRef.current = true;
    try {
      const newPath = await createNode(projectId, parentPath, name, kind);
      // Manual creation → land in edit mode (markdown opens "source", not the
      // empty preview pane). AI-created files come in through other paths and
      // keep the default preview behavior.
      if (kind === "file") onOpenFile(newPath, basename(newPath), true);
    } catch (err) {
      committingRef.current = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[create] failed", err);
      setError(msg);
    }
  }, [value, kind, parentPath, projectId, createNode, cancelCreate, onOpenFile]);

  return (
    <div
      className="flex w-full items-center gap-[8px] py-[3px] font-mono text-mono text-body"
      style={{ paddingLeft: indentPx }}
      title={error ?? undefined}
    >
      <span className="w-[11px] shrink-0" />
      <FileIcon
        isDir={kind === "dir"}
        isOpen={false}
        filename={kind === "dir" ? "" : value || "novo"}
        className={kind === "dir" ? "text-muted" : "text-muted-soft"}
      />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        placeholder={kind === "dir" ? t("tree.newFolderPlaceholder") : t("tree.newFilePlaceholder")}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelCreate(projectId);
          }
        }}
        onBlur={() => {
          // Commit on blur when there's a name (VS Code parity); otherwise drop.
          if (committingRef.current) return;
          if (value.trim()) void commit();
          else cancelCreate(projectId);
        }}
        className={cn(
          "min-w-0 flex-1 rounded-xs border bg-surface-strong/45 px-[6px] py-[1px]",
          "text-mono text-ink outline-none",
          error ? "border-danger focus:border-danger" : "border-accent/60 focus:border-accent",
        )}
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
}

interface TreeChildrenProps extends TreeNodeActions {
  projectId: string;
  path: string;
  depth: number;
  state: ChildrenState | undefined;
}

function TreeChildren({
  projectId,
  path,
  depth,
  state,
  onOpenFile,
  onOpenInTerminal,
  onLaunchCliInPath,
}: TreeChildrenProps) {
  const { t } = useTranslation();
  const creating = useExplorerStore((s) => s.byProject[projectId]?.creating);
  const indentPx = depth * 12 + 8;

  const createRow =
    creating && creating.parentPath === path ? (
      <CreateRow
        projectId={projectId}
        parentPath={path}
        kind={creating.kind}
        depth={depth}
        onOpenFile={onOpenFile}
      />
    ) : null;

  if (state === undefined || state === "loading") {
    return (
      <>
        {createRow}
        <div
          className="flex items-center gap-[6px] py-[3px] font-mono text-label text-muted-soft"
          style={{ paddingLeft: indentPx }}
        >
          <span className="h-[8px] w-[8px] animate-pulse rounded-pill bg-hairline-strong" />
          {t("common.loading")}
        </div>
      </>
    );
  }
  if (Array.isArray(state)) {
    if (state.length === 0) {
      return (
        <>
          {createRow}
          {createRow ? null : (
            <div
              className="py-[3px] font-mono text-label text-muted-soft"
              style={{ paddingLeft: indentPx }}
            >
              {t("tree.empty")}
            </div>
          )}
        </>
      );
    }
    return (
      <>
        {createRow}
        {state.map((c) => (
          <TreeNode
            key={c.path}
            projectId={projectId}
            entry={c}
            depth={depth}
            onOpenFile={onOpenFile}
            onOpenInTerminal={onOpenInTerminal}
            onLaunchCliInPath={onLaunchCliInPath}
          />
        ))}
      </>
    );
  }
  // Error state
  return (
    <>
      {createRow}
      <div
        className="py-[3px] font-mono text-label text-danger"
        style={{ paddingLeft: indentPx }}
        title={state.error}
      >
        {t("common.couldNotRead")} · <em>{state.error.slice(0, 60)}</em>
      </div>
    </>
  );
}
