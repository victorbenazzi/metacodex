import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  FolderOpen,
  Pencil,
  Sparkles,
  SquareTerminal,
  Trash2,
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
import {
  gitColorForBadge,
  gitColorForName,
  gitStatusLabelKey,
} from "@/features/git/gitStatus";
import { DEFAULT_CLI_REGISTRY, type CliTool } from "@/features/terminal/cli-registry";
import { cn } from "@/lib/cn";
import { CMD, invoke } from "@/lib/ipc";
import { basename, dirname } from "@/lib/path";
import type { DirEntry } from "@/features/filesystem/filesystem.types";

/** Path currently being dragged. Module-level so drop targets can validate
 * during `dragover` (the DataTransfer payload is unreadable until `drop`). */
let draggingPath: string | null = null;

const DND_MIME = "application/x-metacodex-path";

/** True if dropping `draggingPath` into `destDir` is a meaningful move. */
function canDropInto(destDir: string): boolean {
  if (!draggingPath) return false;
  if (destDir === draggingPath) return false; // onto itself
  if (destDir.startsWith(draggingPath + "/")) return false; // into own descendant
  if (dirname(draggingPath) === destDir) return false; // already there
  return true;
}

export interface TreeNodeActions {
  onOpenFile: (path: string, name: string, openInEditMode?: boolean) => void;
  onRequestDelete: (path: string, name: string, isDir: boolean) => void;
  /** Performs the rename. Resolves with the new absolute path; rejects on failure. */
  onRename: (path: string, newName: string, isDir: boolean) => Promise<string>;
  onOpenInTerminal: (path: string, name: string) => void;
  onLaunchCliInPath: (cli: CliTool, path: string, name: string) => void;
  /** Move `from` into directory `toDir`. */
  onMove: (from: string, toDir: string) => Promise<void>;
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
  onRequestDelete,
  onRename,
  onOpenInTerminal,
  onLaunchCliInPath,
  onMove,
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

  const [editing, setEditing] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const indentPx = depth * 12 + 8;
  // For files, drops route to the containing directory (VS Code parity).
  const dropDir = entry.isDir ? entry.path : dirname(entry.path);

  const handleClick = useCallback(() => {
    setSelected(projectId, { path: entry.path, isDir: entry.isDir });
    if (entry.isDir) {
      void toggle(projectId, entry.path);
    } else {
      onOpenFile(entry.path, entry.name);
    }
  }, [entry, projectId, toggle, onOpenFile, setSelected]);

  const startRename = useCallback(() => setEditing(true), []);
  const cancelRename = useCallback(() => setEditing(false), []);

  const commitRename = useCallback(
    async (newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === entry.name) {
        setEditing(false);
        return;
      }
      try {
        await onRename(entry.path, trimmed, entry.isDir);
        setEditing(false);
      } catch (err) {
        console.warn("[rename] failed", err);
        // keep editing; let the user retry or Esc out
      }
    },
    [entry.isDir, entry.name, entry.path, onRename],
  );

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

  const row = editing ? (
    <RenameRow
      indentPx={indentPx}
      entry={entry}
      isOpen={isOpen}
      onCommit={commitRename}
      onCancel={cancelRename}
    />
  ) : (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            draggingPath = entry.path;
            e.dataTransfer.setData(DND_MIME, entry.path);
            e.dataTransfer.setData("text/plain", entry.path);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            draggingPath = null;
            setIsDropTarget(false);
          }}
          onDragOver={(e) => {
            if (!canDropInto(dropDir)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            if (!isDropTarget) setIsDropTarget(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsDropTarget(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDropTarget(false);
            const from =
              e.dataTransfer.getData(DND_MIME) ||
              e.dataTransfer.getData("text/plain");
            draggingPath = null;
            if (!from) return;
            // Re-validate with the real payload (module var may be stale).
            if (
              from === dropDir ||
              dropDir.startsWith(from + "/") ||
              dirname(from) === dropDir
            ) {
              return;
            }
            void onMove(from, dropDir);
          }}
          onClick={handleClick}
          className={cn(
            "group flex w-full items-center gap-[6px] py-[3px] text-left font-mono text-[12px]",
            "focus-visible:outline-none",
            hidden ? "text-muted" : "text-body",
            isSelected
              ? "bg-accent/15 hover:bg-accent/20"
              : "hover:bg-surface-strong/45 focus-visible:bg-surface-strong/55",
            "data-[state=open]:bg-surface-strong/55",
            // Recent-file tint runs underneath the selection/hover layers
            // and overrides them visually for ~14.4s before fading out.
            isRecent && !isSelected && "animate-explorer-recent-tint",
            isDropTarget &&
              "bg-accent/20 ring-1 ring-inset ring-accent/60",
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
              <Tooltip content={t(gitStatusLabelKey(gitStatus))} side="left">
                <span
                  className={cn(
                    "inline-flex h-[14px] min-w-[12px] items-center justify-center font-mono text-[10px] leading-none",
                    gitColorForBadge(gitStatus),
                  )}
                  // Hovering only this glyph reveals the status meaning — the
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
              <Icon icon={SquareTerminal} size={13} className="text-muted" />
              {t("tree.openInTerminal")}
            </ContextMenuItem>
            <ContextMenuSub
              trigger={
                <>
                  <Icon icon={Sparkles} size={13} className="text-muted" />
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
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={startRename}>
              <Icon icon={Pencil} size={13} className="text-muted" />
              {t("tree.rename")}
            </ContextMenuItem>
            <ContextMenuItem
              destructive
              onSelect={() => onRequestDelete(entry.path, entry.name, true)}
            >
              <Icon icon={Trash2} size={13} />
              {t("tree.deleteFolder")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={revealInFinder}>
              <Icon icon={FolderOpen} size={13} className="text-muted" />
              {t("tree.revealInFinder")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={copyPath}>
              <Icon icon={Copy} size={13} className="text-muted" />
              {t("tree.copyPath")}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => onOpenFile(entry.path, entry.name)}>
              <Icon icon={FolderOpen} size={13} className="text-muted" />
              {t("tree.open")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={startRename}>
              <Icon icon={Pencil} size={13} className="text-muted" />
              {t("tree.rename")}
            </ContextMenuItem>
            <ContextMenuItem
              destructive
              onSelect={() => onRequestDelete(entry.path, entry.name, false)}
            >
              <Icon icon={Trash2} size={13} />
              {t("tree.deleteFile")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={revealInFinder}>
              <Icon icon={FolderOpen} size={13} className="text-muted" />
              {t("tree.revealInFinder")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={copyPath}>
              <Icon icon={Copy} size={13} className="text-muted" />
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
          onRequestDelete={onRequestDelete}
          onRename={onRename}
          onOpenInTerminal={onOpenInTerminal}
          onLaunchCliInPath={onLaunchCliInPath}
          onMove={onMove}
        />
      ) : null}
    </>
  );
});

interface RenameRowProps {
  indentPx: number;
  entry: DirEntry;
  isOpen: boolean;
  onCommit: (newName: string) => void;
  onCancel: () => void;
}

function RenameRow({ indentPx, entry, isOpen, onCommit, onCancel }: RenameRowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(entry.name);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // For files, select the basename portion (before the final dot) so the
    // extension is preserved by default. For folders, select the whole name.
    if (!entry.isDir) {
      const dot = entry.name.lastIndexOf(".");
      if (dot > 0) {
        el.setSelectionRange(0, dot);
        return;
      }
    }
    el.select();
  }, [entry.isDir, entry.name]);

  return (
    <div
      className="flex w-full items-center gap-[6px] py-[3px] font-mono text-[12px] text-body"
      style={{ paddingLeft: indentPx }}
    >
      {entry.isDir ? <ChevronIcon open={isOpen} /> : <span className="w-[11px] shrink-0" />}
      <FileIcon
        isDir={entry.isDir}
        isOpen={isOpen}
        filename={value || entry.name}
        className={entry.isDir ? "text-muted" : "text-muted-soft"}
      />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onCancel()}
        className={cn(
          "min-w-0 flex-1 rounded-xs border border-accent/60 bg-surface-strong/45 px-[6px] py-[1px]",
          "text-[12px] text-ink outline-none focus:border-accent",
        )}
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
}

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
      className="flex w-full items-center gap-[6px] py-[3px] font-mono text-[12px] text-body"
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
          "text-[12px] text-ink outline-none",
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
  onRequestDelete,
  onRename,
  onOpenInTerminal,
  onLaunchCliInPath,
  onMove,
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
          className="flex items-center gap-[6px] py-[3px] font-mono text-[11px] text-muted-soft"
          style={{ paddingLeft: indentPx }}
        >
          <span className="h-[8px] w-[8px] animate-pulse rounded-full bg-hairline-strong" />
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
              className="py-[3px] font-mono text-[11px] text-muted-soft"
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
            onRequestDelete={onRequestDelete}
            onRename={onRename}
            onOpenInTerminal={onOpenInTerminal}
            onLaunchCliInPath={onLaunchCliInPath}
            onMove={onMove}
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
        className="py-[3px] font-mono text-[11px] text-danger"
        style={{ paddingLeft: indentPx }}
        title={state.error}
      >
        {t("common.couldNotRead")} · <em>{state.error.slice(0, 60)}</em>
      </div>
    </>
  );
}
