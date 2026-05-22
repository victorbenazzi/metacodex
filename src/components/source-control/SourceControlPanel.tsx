import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, RefreshCw, X, Check, ArrowUp, ArrowDown } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { useGitStore } from "@/features/git/git.store";
import {
  gitColorForBadge,
  gitColorForName,
  gitStatusLabelKey,
  gitStatusRank,
} from "@/features/git/gitStatus";
import { basename, dirname } from "@/lib/path";
import { cn } from "@/lib/cn";

interface SourceControlPanelProps {
  projectId: string;
  projectPath: string;
  onOpenDiff: (path: string, status: string) => void;
  onClose: () => void;
}

/** Path of `abs` relative to the project `root` (root itself → its basename). */
function relativeTo(root: string, abs: string): string {
  const r = root.replace(/\/+$/, "");
  if (abs === r) return basename(abs);
  if (abs.startsWith(r + "/")) return abs.slice(r.length + 1);
  return abs;
}

/**
 * Right-docked Source Control overview: the current branch, a count, and the
 * list of changed files. Clicking a file opens its HEAD ⇄ working diff as a tab.
 * Read-only — staging/commit are out of scope for now.
 */
export function SourceControlPanel({
  projectId,
  projectPath,
  onOpenDiff,
  onClose,
}: SourceControlPanelProps) {
  const { t } = useTranslation();
  const git = useGitStore((s) => s.byProject[projectId]);
  const refresh = useGitStore((s) => s.refresh);

  const entries = useMemo(() => {
    const statuses = git?.statuses ?? {};
    return Object.entries(statuses)
      .map(([absPath, code]) => ({ absPath, code }))
      .sort((a, b) => {
        const r = gitStatusRank(a.code) - gitStatusRank(b.code);
        return r !== 0 ? r : a.absPath.localeCompare(b.absPath);
      });
  }, [git]);

  const count = entries.length;

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l border-hairline bg-canvas"
      aria-label={t("sourceControl.title")}
    >
      {/* Header — section label + count + actions, branch on a subline. */}
      <div className="shrink-0 border-b border-hairline px-[12px] pt-[10px] pb-[8px]">
        <div className="flex items-center gap-[8px]">
          <span className="editorial-caps text-muted">{t("sourceControl.title")}</span>
          {count > 0 ? (
            <span className="font-mono text-[10px] tabular-nums text-muted-soft">{count}</span>
          ) : null}
          <div className="ml-auto flex items-center gap-[2px]">
            <Tooltip content={t("sourceControl.refresh")} side="bottom">
              <button
                type="button"
                onClick={() => void refresh(projectId, projectPath)}
                aria-label={t("sourceControl.refresh")}
                className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-xs text-muted transition-colors hover:bg-surface-strong/55 hover:text-ink"
              >
                <Icon icon={RefreshCw} size={13} />
              </button>
            </Tooltip>
            <Tooltip content={t("sourceControl.close")} side="bottom">
              <button
                type="button"
                onClick={onClose}
                aria-label={t("sourceControl.close")}
                className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-xs text-muted transition-colors hover:bg-surface-strong/55 hover:text-ink"
              >
                <Icon icon={X} size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
        {git?.branch ? (
          <div className="mt-[5px] flex items-center gap-[5px] font-mono text-[11px] text-muted">
            <Icon icon={GitBranch} size={10} strokeWidth={2} />
            <span className="truncate text-body">{git.branch}</span>
            {git.ahead > 0 ? (
              <span className="inline-flex shrink-0 items-center text-muted-soft">
                <Icon icon={ArrowUp} size={9} strokeWidth={2} />
                {git.ahead}
              </span>
            ) : null}
            {git.behind > 0 ? (
              <span className="inline-flex shrink-0 items-center text-muted-soft">
                <Icon icon={ArrowDown} size={9} strokeWidth={2} />
                {git.behind}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Body — empty state or the changed-files list. */}
      {count === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-[10px] px-[24px] text-center">
          <Icon icon={Check} size={20} className="text-muted-soft" />
          <p className="font-mono text-[12px] text-muted">{t("sourceControl.empty")}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-[4px]">
          {entries.map(({ absPath, code }) => {
            const rel = relativeTo(projectPath, absPath);
            const name = basename(rel);
            const dir = dirname(rel);
            const showDir = dir !== "" && dir !== "." && dir !== "/";
            return (
              <button
                key={absPath}
                type="button"
                onClick={() => onOpenDiff(absPath, code)}
                title={absPath}
                className={cn(
                  "group flex w-full min-w-0 items-center gap-[8px] px-[12px] py-[4px] text-left",
                  "transition-colors hover:bg-surface-strong/45",
                  "focus-visible:bg-surface-strong/55 focus-visible:outline-none",
                )}
              >
                <Tooltip content={t(gitStatusLabelKey(code))} side="left">
                  <span
                    className={cn(
                      "inline-flex h-[14px] w-[12px] shrink-0 items-center justify-center font-mono text-[10px] leading-none",
                      gitColorForBadge(code),
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {code}
                  </span>
                </Tooltip>
                <span className={cn("min-w-0 flex-1 truncate font-mono text-[12px]", gitColorForName(code))}>
                  {name}
                </span>
                {showDir ? (
                  <span className="max-w-[45%] shrink-0 truncate font-mono text-[10px] text-muted-soft">
                    {dir}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
