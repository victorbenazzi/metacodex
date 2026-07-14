import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { useWorktreesStore } from "@/features/git/worktrees.store";
import { toast } from "@/features/ui/toast.store";
import type { WorktreeInfo, MergeStrategy } from "@/features/git/worktrees.service";
import { CMD, invoke } from "@/lib/ipc";
import { basename } from "@/lib/path";
import { cn } from "@/lib/cn";
import { WorktreeMergeDialog } from "./WorktreeMergeDialog";
import { WorktreeCreateDialog } from "./WorktreeCreateDialog";

interface WorktreesSectionProps {
  projectId: string;
  projectPath: string;
  onOpenInTerminal: (cwd: string, name: string) => void;
}

export function WorktreesSection({
  projectId,
  projectPath,
  onOpenInTerminal,
}: WorktreesSectionProps) {
  const { t } = useTranslation();
  const bucket = useWorktreesStore((s) => s.byProject[projectId]);
  const occupancy = useWorktreesStore((s) => s.occupancyByPath);
  const refresh = useWorktreesStore((s) => s.refresh);
  const removeWt = useWorktreesStore((s) => s.remove);
  const merge = useWorktreesStore((s) => s.merge);

  const [expanded, setExpanded] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<WorktreeInfo | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WorktreeInfo | null>(null);
  const [forceRemove, setForceRemove] = useState(false);

  const items = bucket?.worktrees ?? [];
  // Hide `is_main` from the list — the user already sees their main project in
  // the title bar; only show worktrees the agent flow actually creates.
  const visible = items.filter((w) => !w.isMain);

  const handleMerge = async (strategy: MergeStrategy) => {
    if (!mergeTarget?.branch) return;
    try {
      await merge(projectId, projectPath, mergeTarget.branch, strategy);
      setMergeTarget(null);
    } catch (err) {
      toast.error(
        t("sourceControl.worktrees.mergeFailedTitle"),
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      await removeWt(projectId, projectPath, removeTarget.path, forceRemove);
      setRemoveTarget(null);
      setForceRemove(false);
    } catch (err) {
      toast.error(
        t("sourceControl.worktrees.removeFailedTitle"),
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <section className="border-b border-hairline-soft">
      <header
        className="flex items-center justify-between px-[12px] py-[8px]"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <span className="flex items-center gap-[6px]">
          <Icon
            icon={expanded ? ChevronDown : ChevronRight}
            size={12}
            className="text-muted"
          />
          <span className="editorial-caps text-muted">
            {t("sourceControl.worktrees.title")}
          </span>
          {visible.length > 0 ? (
            <span className="font-mono text-micro text-muted-soft">
              {visible.length}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-[3px]">
          <IconButton
            label={t("sourceControl.worktrees.refresh")}
            onClick={(e) => {
              e.stopPropagation();
              void refresh(projectId, projectPath);
            }}
            icon={RefreshCw}
            spinning={bucket?.loading}
          />
          <IconButton
            label={t("sourceControl.worktrees.add")}
            onClick={(e) => {
              e.stopPropagation();
              setCreateOpen(true);
            }}
            icon={Plus}
          />
        </span>
      </header>

      {expanded ? (
        <ul className="pb-[6px]">
          {visible.length === 0 ? (
            <li className="px-[12px] pb-[8px] text-label text-muted-soft">
              {t("sourceControl.worktrees.empty")}
            </li>
          ) : (
            visible.map((w) => {
              const occupants = occupancy[w.path] ?? [];
              return (
                <li
                  key={w.path}
                  className="group flex items-center justify-between gap-[8px] px-[12px] py-[6px] transition-colors hover:bg-surface-strong/35"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-[6px]">
                      <Icon icon={GitBranch} size={12} className="text-muted" />
                      <span className="truncate font-mono text-caption text-ink">
                        {w.branch ?? basename(w.path)}
                      </span>
                      {occupants.length > 0 ? (
                        <span
                          className="inline-flex h-[6px] w-[6px] shrink-0 rounded-pill bg-success"
                          aria-label={t("sourceControl.worktrees.occupiedBy", {
                            count: occupants.length,
                          })}
                        />
                      ) : null}
                      {w.locked ? (
                        <span className="rounded-xs border border-hairline px-[4px] py-0 font-mono text-micro uppercase text-muted">
                          {t("sourceControl.worktrees.locked")}
                        </span>
                      ) : null}
                    </div>
                    <div
                      className="truncate font-mono text-micro text-muted-soft"
                      title={w.path}
                    >
                      {w.path}
                    </div>
                  </div>
                  <DropdownRoot>
                    <DropdownTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("common.more")}
                        className="inline-flex h-[20px] w-[20px] items-center justify-center rounded-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-strong/55 hover:text-ink"
                      >
                        <Icon icon={MoreHorizontal} size={12} />
                      </button>
                    </DropdownTrigger>
                    <DropdownContent align="end" sideOffset={6}>
                      <DropdownItem
                        onSelect={() => onOpenInTerminal(w.path, w.branch ?? basename(w.path))}
                      >
                        {t("sourceControl.worktrees.openTerminalHere")}
                      </DropdownItem>
                      <DropdownItem
                        onSelect={() => {
                          void invoke(CMD.revealInFinder, { path: w.path });
                        }}
                      >
                        {t("sourceControl.worktrees.revealInFinder")}
                      </DropdownItem>
                      <DropdownSeparator />
                      <DropdownItem
                        disabled={!w.branch}
                        onSelect={() => setMergeTarget(w)}
                      >
                        {t("sourceControl.worktrees.merge")}
                      </DropdownItem>
                      <DropdownItem
                        destructive
                        onSelect={() => setRemoveTarget(w)}
                      >
                        {t("sourceControl.worktrees.abandon")}
                      </DropdownItem>
                    </DropdownContent>
                  </DropdownRoot>
                </li>
              );
            })
          )}
        </ul>
      ) : null}

      <WorktreeCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        projectPath={projectPath}
        defaultBranchName=""
        defaultCliId={null}
        onAfterCreate={() => setCreateOpen(false)}
      />

      <WorktreeMergeDialog
        worktree={mergeTarget}
        onCancel={() => setMergeTarget(null)}
        onConfirm={handleMerge}
      />

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => {
          if (!o) {
            setRemoveTarget(null);
            setForceRemove(false);
          }
        }}
        tone="destructive"
        title={t("sourceControl.worktrees.abandonTitle", {
          branch: removeTarget?.branch ?? "",
        })}
        description={t("sourceControl.worktrees.abandonBody")}
        confirmLabel={t("sourceControl.worktrees.abandon")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleRemove}
        skipOption={{
          label: t("sourceControl.worktrees.abandonForce"),
          checked: forceRemove,
          onChange: setForceRemove,
        }}
      />
    </section>
  );
}

function IconButton({
  label,
  icon,
  onClick,
  spinning,
}: {
  label: string;
  icon: typeof Plus;
  onClick: (e: React.MouseEvent) => void;
  spinning?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-[20px] w-[20px] items-center justify-center rounded-xs text-muted",
        "hover:bg-surface-strong/55 hover:text-ink",
      )}
    >
      <Icon
        icon={icon}
        size={12}
        className={spinning ? "animate-spin motion-reduce:animate-none" : ""}
      />
    </button>
  );
}
