import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Trash2 } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { useResumeStore } from "@/features/resume/resume.store";
import { buildResumeTab } from "@/features/resume/resumeLaunch";
import { useTabsStore, WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { cliById } from "@/features/terminal/cli-registry";
import { resumeFlagFor } from "@/features/resume/sessionDetectors";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import {
  cliDetectionFor,
  useCliDetections,
} from "@/features/terminal/cli-detection";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import type { ResumeEntry } from "@/features/resume/resume.service";

interface ResumeCardsProps {
  /** When set, restrict to this project. Otherwise show the most recent global. */
  projectId?: string;
  /** Title text shown above the cards. */
  title?: string;
  /** Max entries to display. */
  limit?: number;
}

/**
 * Resume tile group — surfaces recent agent sessions so the user can pick up
 * where they left off in one click. Returns null when there's nothing to show
 * (so callers can use `<ResumeCards />` unconditionally and let it self-hide).
 */
export function ResumeCards({ projectId, title, limit = 5 }: ResumeCardsProps) {
  const { t } = useTranslation();
  const recent = useResumeStore((s) => s.recent);
  const forProject = useResumeStore((s) => s.forProject);
  const discard = useResumeStore((s) => s.discard);
  const openTab = useTabsStore((s) => s.openTab);
  const detections = useCliDetections();

  const entries = useMemo(() => {
    const all = projectId ? forProject(projectId) : recent(7);
    return all
      .filter((e) => resumeFlagFor(e.cliId) !== null)
      .slice(0, limit);
  }, [projectId, forProject, recent, limit]);

  if (entries.length === 0) return null;

  const resume = (entry: ResumeEntry) => {
    const tab = buildResumeTab(entry);
    if (!tab) return;
    const key = entry.projectId ?? WORKSPACE_NULL;
    openTab(key, tab);
  };

  return (
    <section className="flex flex-col gap-[10px]">
      {title ? <h3 className="editorial-caps text-muted">{title}</h3> : null}
      <ul className="grid grid-cols-1 gap-[8px]">
        {entries.map((entry) => {
          const cli = cliById(entry.cliId);
          const detection = cli ? cliDetectionFor(cli, detections) : null;
          const installed = detection ? detection.status === "installed" : true;
          const BrandIcon = cli ? CLI_BRAND_ICONS[cli.id] : undefined;
          return (
            <li
              key={entry.id}
              className={cn(
                "flex items-center gap-[12px] rounded-sm border border-hairline-soft bg-canvas-soft px-[12px] py-[10px]",
              )}
            >
              <span className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-xs border border-hairline">
                {BrandIcon ? <BrandIcon size={18} /> : null}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-[8px]">
                  <span className="truncate text-[13px] font-medium text-ink">
                    {cli?.label ?? entry.cliId}
                  </span>
                  {entry.branch ? (
                    <span className="inline-flex items-center gap-[3px] font-mono text-[10px] text-muted">
                      <Icon icon={GitBranch} size={10} />
                      {entry.branch}
                    </span>
                  ) : null}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-soft" title={entry.cwd}>
                  {entry.cwd}
                </div>
                <div className="font-mono text-[10px] text-muted-soft">
                  {t("resume.lastSeen", { ago: timeAgo(entry.lastSeenAt) })}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-[6px]">
                {installed ? (
                  <Button variant="primary" size="sm" onClick={() => resume(entry)}>
                    {t("resume.resumeButton")}
                  </Button>
                ) : (
                  <span className="text-[10px] text-warn">
                    {t("resume.cliUnavailable", { cli: cli?.label ?? entry.cliId })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void discard(entry.id)}
                  aria-label={t("resume.discardButton")}
                  className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-xs text-muted hover:bg-surface-strong/55 hover:text-ink"
                >
                  <Icon icon={Trash2} size={11} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const seconds = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
