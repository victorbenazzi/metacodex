import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Check, ArrowUp, ArrowDown, GitCompare } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { useGitStore } from "@/features/git/git.store";
import {
  gitColorForBadge,
  gitStatusLabelKey,
  gitStatusRank,
} from "@/features/git/gitStatus";
import { basename, dirname } from "@/lib/path";
import { cn } from "@/lib/cn";

interface SourceControlPanelProps {
  projectId: string;
  projectPath: string;
  onOpenDiff: (path: string, status: string) => void;
}

/** Path of `abs` relative to the project `root` (root itself → its basename). */
function relativeTo(root: string, abs: string): string {
  const r = root.replace(/\/+$/, "");
  if (abs === r) return basename(abs);
  if (abs.startsWith(r + "/")) return abs.slice(r.length + 1);
  return abs;
}

function compactCount(value: number): string {
  const abs = Math.abs(value);
  if (abs < 10_000) return String(value);

  const unit = abs < 1_000_000 ? 1_000 : 1_000_000;
  const suffix = unit === 1_000 ? "k" : "m";
  const scaled = value / unit;
  const decimals = Math.abs(scaled) < 10 && !Number.isInteger(scaled) ? 1 : 0;
  return `${scaled.toFixed(decimals).replace(/\.0$/, "")}${suffix}`;
}

function fileBadge(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tsx")) return "TSX";
  if (lower.endsWith(".jsx")) return "JSX";
  const ext = name.includes(".") ? name.split(".").pop() : undefined;
  return ext ? ext.slice(0, 3).toUpperCase() : "TXT";
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
}: SourceControlPanelProps) {
  const { t } = useTranslation();
  const git = useGitStore((s) => s.byProject[projectId]);

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
  const totalAdditions = git?.stats?.additions ?? 0;
  const totalDeletions = git?.stats?.deletions ?? 0;

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l border-hairline bg-canvas"
      aria-label={t("sourceControl.title")}
    >
      <header className="flex h-[30px] shrink-0 items-center border-b border-hairline-soft px-[12px]">
        <span className="editorial-caps truncate">{t("sourceControl.title")}</span>
      </header>

      <div className="shrink-0 border-b border-hairline-soft px-[14px] py-[12px]">
        {git?.branch ? (
          <div className="flex min-w-0 items-center gap-[6px] font-mono text-[12px]">
            <Icon icon={GitBranch} size={11} strokeWidth={2} className="shrink-0 text-muted-soft" />
            <span className="min-w-0 truncate text-body" title={git.branch}>{git.branch}</span>
            {git.ahead > 0 || git.behind > 0 ? (
              <span className="ml-auto inline-flex shrink-0 items-center gap-[6px] font-mono text-[11px] tabular-nums text-muted">
                {git.ahead > 0 ? (
                  <span className="inline-flex items-center gap-[1px]">
                    <Icon icon={ArrowUp} size={10} strokeWidth={2} />
                    {git.ahead}
                  </span>
                ) : null}
                {git.behind > 0 ? (
                  <span className="inline-flex items-center gap-[1px]">
                    <Icon icon={ArrowDown} size={10} strokeWidth={2} />
                    {git.behind}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="mt-[10px] flex items-baseline gap-[12px]">
          <Tooltip content={t("sourceControl.additions", { count: totalAdditions })} side="bottom">
            <span className="whitespace-nowrap font-mono text-[15px] font-medium leading-none tabular-nums text-success">
              +{compactCount(totalAdditions)}
            </span>
          </Tooltip>
          <Tooltip content={t("sourceControl.deletions", { count: totalDeletions })} side="bottom">
            <span className="whitespace-nowrap font-mono text-[15px] font-medium leading-none tabular-nums text-danger">
              −{compactCount(totalDeletions)}
            </span>
          </Tooltip>
          {count > 0 ? (
            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-soft">
              {t("sourceControl.changedFiles", { count })}
            </span>
          ) : null}
        </div>
      </div>

      {count === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-[10px] px-[24px] text-center">
          <Icon icon={Check} size={20} className="text-muted-soft" />
          <p className="font-mono text-[12px] text-muted">{t("sourceControl.empty")}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-[8px]">
          {entries.map(({ absPath, code }) => {
            const rel = relativeTo(projectPath, absPath);
            const name = basename(rel);
            const dir = dirname(rel);
            const showDir = dir !== "" && dir !== "." && dir !== "/";
            const stats = git?.stats?.files?.[absPath];
            const additions = stats?.additions ?? 0;
            const deletions = stats?.deletions ?? 0;

            return (
              <div
                key={absPath}
                className="group grid min-h-[32px] grid-cols-[minmax(0,1fr)_48px_48px_28px] items-center gap-[2px] px-[8px] transition-colors duration-[var(--dur-fast)] hover:bg-surface-strong/35"
              >
                <button
                  type="button"
                  onClick={() => onOpenDiff(absPath, code)}
                  title={absPath}
                  aria-label={`${t(gitStatusLabelKey(code))}: ${rel}`}
                  className="flex min-w-0 items-center gap-[8px] rounded-xs px-[6px] py-[5px] text-left transition-colors duration-[var(--dur-fast)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
                >
                  <span className="inline-flex h-[18px] min-w-[25px] shrink-0 items-center justify-center rounded-[3px] border border-hairline bg-surface-card px-[4px] font-mono text-[9px] leading-none text-muted-soft">
                    {fileBadge(name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-body group-hover:text-ink">
                    {showDir ? <span className="text-muted">{dir}/</span> : null}
                    <span className="text-ink">{name}</span>
                  </span>
                  <Tooltip content={t(gitStatusLabelKey(code))} side="left">
                    <span
                      className={cn(
                        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-xs bg-surface-strong/45 font-mono text-[10px] leading-none",
                        gitColorForBadge(code),
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {code}
                    </span>
                  </Tooltip>
                </button>

                <span className="justify-self-end font-mono text-[12px] tabular-nums text-success">
                  {additions > 0 ? `+${compactCount(additions)}` : ""}
                </span>
                <span className="justify-self-end font-mono text-[12px] tabular-nums text-danger">
                  {deletions > 0 ? `-${compactCount(deletions)}` : ""}
                </span>
                <Tooltip content={t("sourceControl.openDiff")} side="left">
                  <button
                    type="button"
                    onClick={() => onOpenDiff(absPath, code)}
                    aria-label={`${t("sourceControl.openDiff")}: ${rel}`}
                    className={cn(
                      "inline-flex h-[26px] w-[26px] items-center justify-center justify-self-end rounded-xs text-muted",
                      "opacity-75 transition-colors duration-[var(--dur-fast)] hover:bg-surface-strong/55 hover:text-ink group-hover:opacity-100",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
                    )}
                  >
                    <Icon icon={GitCompare} size={13} strokeWidth={1.8} />
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
