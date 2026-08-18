import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  FileLock2,
  GitBranch,
  MoreHorizontal,
  RotateCcw,
} from "@/components/ui/icons";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import {
  DialogContent,
  DialogRoot,
} from "@/components/ui/Dialog";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { FileIcon } from "@/components/file-explorer/FileIcon";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { WorktreesSection } from "./WorktreesSection";
import { InlineDiffPreview } from "./InlineDiffPreview";
import { isPathSelected, useChangesUiStore } from "@/features/git/changes.store";
import { gitActions } from "@/features/git/git.actions";
import { useGitStore } from "@/features/git/git.store";
import {
  compactCount,
  gitStatusRank,
} from "@/features/git/gitStatus";
import { basename, dirname } from "@/lib/path";
import { cn } from "@/lib/cn";

const LIST_PAGE = 250;

export interface ChangesEntry {
  absPath: string;
  code: string;
}

interface ChangesViewProps {
  projectId: string;
  projectPath: string;
  variant: "page" | "panel";
  onOpenFile?: (path: string, name: string) => void;
  onOpenChanges?: (expandPath?: string) => void;
  onOpenInTerminal?: (cwd: string, name: string) => void;
}

function relativeTo(root: string, abs: string): string {
  const r = root.replace(/\/+$/, "");
  if (abs === r) return basename(abs);
  if (abs.startsWith(`${r}/`)) return abs.slice(r.length + 1);
  return abs;
}

function statusBadge(code: string, t: (key: string) => string): { label: string; className: string } {
  if (code === "?" || code === "A") {
    return { label: t("sourceControl.badgeNew"), className: "text-success" };
  }
  if (code === "D") {
    return { label: t("sourceControl.badgeDeleted"), className: "text-danger" };
  }
  if (code === "R") {
    return { label: t("sourceControl.badgeRenamed"), className: "text-warn" };
  }
  if (code === "!") {
    return { label: t("sourceControl.badgeConflict"), className: "text-danger" };
  }
  return { label: t("sourceControl.badgeModified"), className: "text-warn" };
}

export function ChangesView({
  projectId,
  projectPath,
  variant,
  onOpenFile,
  onOpenChanges,
  onOpenInTerminal,
}: ChangesViewProps) {
  const { t } = useTranslation();
  const git = useGitStore((s) => s.byProject[projectId]);
  const ui = useChangesUiStore((s) => s.byProject[projectId]);
  const unselected = ui?.unselected ?? {};
  const expandedPath = ui?.expandedPath ?? null;
  const message = ui?.message ?? "";
  const busy = useChangesUiStore((s) => s.busy);
  const toggleSelected = useChangesUiStore((s) => s.toggleSelected);
  const selectAll = useChangesUiStore((s) => s.selectAll);
  const selectNone = useChangesUiStore((s) => s.selectNone);
  const setExpanded = useChangesUiStore((s) => s.setExpanded);
  const setMessage = useChangesUiStore((s) => s.setMessage);

  const [visibleCount, setVisibleCount] = useState(LIST_PAGE);
  const [discardPaths, setDiscardPaths] = useState<string[] | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [branchIntent, setBranchIntent] = useState<"branch" | "commit" | "commit-push">("branch");
  const [nudgeMessage, setNudgeMessage] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const entries = useMemo<ChangesEntry[]>(() => {
    const statuses = git?.statuses ?? {};
    return Object.entries(statuses)
      .map(([absPath, code]) => ({ absPath, code }))
      .sort((a, b) => {
        const r = gitStatusRank(a.code) - gitStatusRank(b.code);
        return r !== 0 ? r : a.absPath.localeCompare(b.absPath);
      });
  }, [git]);

  const statusKey = useMemo(
    () => entries.map((e) => `${e.absPath}:${e.code}`).join("\n"),
    [entries],
  );
  const totalAdditions = git?.stats?.additions ?? 0;
  const totalDeletions = git?.stats?.deletions ?? 0;
  const selectedPaths = useMemo(
    () => entries.filter((e) => isPathSelected(unselected, e.absPath)).map((e) => e.absPath),
    [entries, unselected],
  );
  const visible = entries.slice(0, visibleCount);
  const hasSelection = selectedPaths.length > 0;
  const hasMessage = message.trim().length > 0;
  const canCommit = hasSelection && hasMessage && !busy;
  const commitArmed = hasSelection && !busy;

  useEffect(() => {
    void useGitStore.getState().refresh(projectId, projectPath, true);
  }, [projectId, projectPath, statusKey]);

  const runCommit = async (andPush: boolean) => {
    if (!canCommit) return;
    const ok = await gitActions.commit(projectId, projectPath, message.trim(), selectedPaths);
    if (ok && andPush) await gitActions.push(projectId, projectPath);
  };

  const requestCommit = (andPush: boolean) => {
    if (!hasSelection || busy) return;
    if (!hasMessage) {
      setNudgeMessage(true);
      messageRef.current?.focus();
      return;
    }
    void runCommit(andPush);
  };

  const requestBranchCommit = (intent: "commit" | "commit-push") => {
    if (!hasSelection || busy) return;
    if (!hasMessage) {
      setNudgeMessage(true);
      messageRef.current?.focus();
      return;
    }
    setBranchIntent(intent);
    setBranchOpen(true);
  };

  const runBranchThen = async (commit: boolean, push: boolean) => {
    const name = branchName.trim();
    if (!name) return;
    const branched = await gitActions.createBranch(projectId, projectPath, name);
    if (!branched) return;
    setBranchOpen(false);
    setBranchName("");
    if (commit) {
      const ok = await gitActions.commit(projectId, projectPath, message.trim(), selectedPaths);
      if (ok && push) await gitActions.push(projectId, projectPath);
    }
  };

  const onRowActivate = (path: string) => {
    if (variant === "panel") {
      onOpenChanges?.(path);
      setExpanded(projectId, path);
      return;
    }
    setExpanded(projectId, expandedPath === path ? null : path);
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t("v3.workbench.changes")}>
      <header className="flex shrink-0 items-center gap-8px border-b border-hairline-soft px-12px py-6px">
        <div className="flex min-w-0 flex-1 items-center gap-8px">
          <Icon icon={FileLock2} size={12} className="shrink-0 text-muted-soft" />
          <span className="shrink-0 text-caption text-body">{t("v3.workbench.uncommitted")}</span>
          {totalAdditions > 0 || totalDeletions > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-6px font-mono text-label tabular-nums">
              <span className="text-success">+{compactCount(totalAdditions)}</span>
              <span className="text-danger">-{compactCount(totalDeletions)}</span>
            </span>
          ) : null}
          {git?.branch ? (
            <span className="inline-flex min-w-0 items-center gap-4px font-mono text-label text-muted">
              <Icon icon={GitBranch} size={10} className="shrink-0" />
              <span className="truncate text-ink">{git.branch}</span>
            </span>
          ) : null}
        </div>

        <span className="ml-auto inline-flex shrink-0 items-center gap-4px">
          <DropdownRoot>
            <DropdownTrigger asChild>
              <IconButton size="md" aria-label={t("common.more")}>
                <Icon icon={MoreHorizontal} size={14} />
              </IconButton>
            </DropdownTrigger>
            <DropdownContent align="end">
              <DropdownItem onSelect={() => selectAll(projectId)}>
                {t("sourceControl.selectAll")}
              </DropdownItem>
              <DropdownItem onSelect={() => selectNone(projectId, entries.map((e) => e.absPath))}>
                {t("sourceControl.selectNone")}
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem
                destructive
                disabled={selectedPaths.length === 0 || busy}
                onSelect={() => setDiscardPaths(selectedPaths)}
              >
                {t("sourceControl.discardSelected")}
              </DropdownItem>
            </DropdownContent>
          </DropdownRoot>

          <div className="inline-flex overflow-hidden rounded-sm">
            <button
              type="button"
              disabled={!commitArmed}
              onClick={() => requestCommit(false)}
              className={cn(
                "press-feedback h-[26px] px-10px text-caption font-medium",
                "bg-ink text-canvas hover:bg-ink-hover",
                "disabled:cursor-not-allowed disabled:opacity-40",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
              )}
            >
              {t("sourceControl.commit")}
            </button>
            <DropdownRoot>
              <DropdownTrigger asChild>
                <button
                  type="button"
                  disabled={busy || entries.length === 0}
                  aria-label={t("sourceControl.commitMenu")}
                  className={cn(
                    "press-feedback inline-flex h-[26px] w-[22px] cursor-pointer items-center justify-center",
                    "border-l border-canvas/25 bg-ink text-canvas hover:bg-ink-hover",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
                  )}
                >
                  <Icon icon={ChevronDown} size={12} />
                </button>
              </DropdownTrigger>
              <DropdownContent align="end">
                <DropdownItem
                  disabled={!commitArmed}
                  onSelect={() => requestBranchCommit("commit")}
                >
                  {t("sourceControl.createBranchCommit")}
                </DropdownItem>
                <DropdownItem
                  disabled={!commitArmed}
                  onSelect={() => requestBranchCommit("commit-push")}
                >
                  {t("sourceControl.createBranchCommitPush")}
                </DropdownItem>
                <DropdownItem
                  onSelect={() => {
                    setBranchIntent("branch");
                    setBranchOpen(true);
                  }}
                >
                  {t("sourceControl.createBranch")}
                </DropdownItem>
                <DropdownItem disabled={!commitArmed} onSelect={() => requestCommit(true)}>
                  {t("sourceControl.commitPush")}
                </DropdownItem>
              </DropdownContent>
            </DropdownRoot>
          </div>
        </span>
      </header>

      {variant === "page" ? (
        <div className="shrink-0 border-b border-hairline-soft px-12px py-8px">
          <textarea
            ref={messageRef}
            value={message}
            onChange={(e) => {
              setMessage(projectId, e.target.value);
              if (nudgeMessage) setNudgeMessage(false);
            }}
            rows={2}
            placeholder={t("sourceControl.messagePlaceholder")}
            aria-invalid={nudgeMessage || undefined}
            className={cn(
              "w-full resize-none rounded-sm border bg-canvas px-10px py-7px text-ui text-ink outline-none placeholder:text-muted-soft",
              nudgeMessage
                ? "border-warn focus-visible:border-warn"
                : "border-hairline-soft focus-visible:border-hairline-strong",
            )}
          />
          {nudgeMessage ? (
            <p className="mt-4px text-label text-warn">{t("sourceControl.messageRequired")}</p>
          ) : null}
        </div>
      ) : null}

      {variant === "panel" ? (
        <WorktreesSection
          projectId={projectId}
          projectPath={projectPath}
          onOpenInTerminal={onOpenInTerminal ?? (() => undefined)}
        />
      ) : null}

      {entries.length === 0 ? (
        <div className="min-h-0 flex-1">
          <EmptyState icon={Check} body={t("sourceControl.empty")} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-4px">
          {variant === "panel" ? (
            <div className="px-12px pb-6px">
              <textarea
                ref={messageRef}
                value={message}
                onChange={(e) => {
                  setMessage(projectId, e.target.value);
                  if (nudgeMessage) setNudgeMessage(false);
                }}
                rows={2}
                placeholder={t("sourceControl.messagePlaceholder")}
                aria-invalid={nudgeMessage || undefined}
                className={cn(
                  "w-full resize-none rounded-sm border bg-canvas px-8px py-6px text-caption text-ink outline-none placeholder:text-muted-soft",
                  nudgeMessage
                    ? "border-warn focus-visible:border-warn"
                    : "border-hairline-soft focus-visible:border-hairline-strong",
                )}
              />
              {nudgeMessage ? (
                <p className="mt-4px text-label text-warn">{t("sourceControl.messageRequired")}</p>
              ) : null}
            </div>
          ) : null}
          {visible.map((entry) => {
            const rel = relativeTo(projectPath, entry.absPath);
            const name = basename(rel);
            const dir = dirname(rel);
            const showDir = dir !== "" && dir !== "." && dir !== "/";
            const stats = git?.stats?.files?.[entry.absPath];
            const additions = stats?.additions ?? 0;
            const deletions = stats?.deletions ?? 0;
            const selected = isPathSelected(unselected, entry.absPath);
            const expanded = variant === "page" && expandedPath === entry.absPath;
            const badge = statusBadge(entry.code, t);

            return (
              <div
                key={entry.absPath}
                className={cn(expanded && "bg-success/10")}
                style={{ contentVisibility: "auto", containIntrinsicSize: "0 32px" }}
              >
                <div
                  className={cn(
                    "group flex min-h-[32px] items-center gap-6px px-8px",
                    "transition-colors duration-fast hover:bg-surface-strong/35",
                    expanded && "bg-surface-strong/25",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelected(projectId, entry.absPath, selected)}
                    aria-label={t("sourceControl.selectFile", { name })}
                    className="h-[13px] w-[13px] shrink-0 accent-[var(--accent)]"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    title={rel}
                    onClick={() => onRowActivate(entry.absPath)}
                    className="flex min-w-0 flex-1 items-center gap-8px rounded-xs py-4px text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
                  >
                    <FileIcon isDir={false} filename={name} size={14} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate font-mono text-mono text-body">
                      {showDir ? <span className="text-muted">{dir}/</span> : null}
                      <span className="text-ink">{name}</span>
                    </span>
                    {additions > 0 ? (
                      <span className="shrink-0 font-mono text-label tabular-nums text-success">
                        +{compactCount(additions)}
                      </span>
                    ) : null}
                    {deletions > 0 ? (
                      <span className="shrink-0 font-mono text-label tabular-nums text-danger">
                        -{compactCount(deletions)}
                      </span>
                    ) : null}
                    <span className={cn("shrink-0 text-label", badge.className)}>{badge.label}</span>
                  </button>
                  <span className="hidden shrink-0 items-center group-hover:inline-flex">
                    {onOpenFile ? (
                      <Tooltip content={t("sourceControl.openFile")} side="left">
                        <IconButton
                          size="sm"
                          aria-label={t("sourceControl.openFile")}
                          onClick={() => onOpenFile(entry.absPath, name)}
                        >
                          <Icon icon={ArrowUpRight} size={12} />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    <Tooltip content={t("sourceControl.discardFile")} side="left">
                      <IconButton
                        size="sm"
                        aria-label={t("sourceControl.discardFile")}
                        onClick={() => setDiscardPaths([entry.absPath])}
                      >
                        <Icon icon={RotateCcw} size={12} />
                      </IconButton>
                    </Tooltip>
                  </span>
                </div>
                {expanded ? (
                  <InlineDiffPreview
                    projectId={projectId}
                    path={entry.absPath}
                    additions={additions}
                    deletions={deletions}
                  />
                ) : null}
              </div>
            );
          })}
          {entries.length > visibleCount ? (
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + LIST_PAGE)}
              className="mx-8px my-8px flex h-[28px] w-[calc(100%-16px)] items-center justify-center rounded-sm text-caption text-muted transition-colors duration-fast hover:bg-surface-strong/40 hover:text-ink"
            >
              {t("sourceControl.showMore", { count: entries.length - visibleCount })}
            </button>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={discardPaths !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardPaths(null);
        }}
        tone="destructive"
        title={t("sourceControl.discardTitle")}
        description={
          discardPaths && discardPaths.length === 1
            ? t("sourceControl.discardOne", { name: basename(discardPaths[0]) })
            : t("sourceControl.discardMany", { count: discardPaths?.length ?? 0 })
        }
        confirmLabel={t("sourceControl.discardConfirm")}
        pending={busy}
        onConfirm={() => {
          if (!discardPaths || discardPaths.length === 0) return;
          void gitActions.discard(projectId, projectPath, discardPaths);
        }}
      />

      <DialogRoot open={branchOpen} onOpenChange={setBranchOpen}>
        <DialogContent
          title={t("sourceControl.createBranch")}
          width={380}
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => setBranchOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={
                  !branchName.trim() ||
                  busy ||
                  (branchIntent !== "branch" && !canCommit)
                }
                onClick={() =>
                  void runBranchThen(
                    branchIntent !== "branch",
                    branchIntent === "commit-push",
                  )
                }
              >
                {branchIntent === "commit-push"
                  ? t("sourceControl.createBranchCommitPush")
                  : branchIntent === "commit"
                    ? t("sourceControl.createBranchCommit")
                    : t("sourceControl.createBranch")}
              </Button>
            </>
          }
        >
          <label className="block text-caption text-muted" htmlFor="changes-branch-name">
            {t("sourceControl.branchName")}
          </label>
          <input
            id="changes-branch-name"
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            autoFocus
            className="mt-6px w-full rounded-sm border border-hairline-strong bg-canvas px-10px py-7px font-mono text-caption text-ink outline-none focus-visible:border-ink"
          />
        </DialogContent>
      </DialogRoot>
    </section>
  );
}
