import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fsApi } from "@/features/filesystem/filesystem.service";
import { gitApi } from "@/features/git/git.service";
import { collapseUnchanged, diffLines } from "@/features/git/lineDiff";
import { LARGE_DIFF_CHARS, isLargeLineDiff } from "@/features/git/gitStatus";
import { useChangesUiStore } from "@/features/git/changes.store";
import { cn } from "@/lib/cn";
import { LargeDiffPlaceholder } from "./LargeDiffPlaceholder";

const PREVIEW_MAX_ROWS = 80;

interface InlineDiffPreviewProps {
  projectId: string;
  path: string;
  additions: number;
  deletions: number;
}

export function InlineDiffPreview({
  projectId,
  path,
  additions,
  deletions,
}: InlineDiffPreviewProps) {
  const { t } = useTranslation();
  const loaded = useChangesUiStore((s) => s.byProject[projectId]?.loadedDiffs[path] === true);
  const markLoaded = useChangesUiStore((s) => s.markDiffLoaded);
  const knownLarge = isLargeLineDiff(additions, deletions);
  const [rows, setRows] = useState<{ type: "eq" | "add" | "del"; text: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discoveredLarge, setDiscoveredLarge] = useState(false);
  const hideUntilLoaded = (knownLarge || discoveredLarge) && !loaded;

  useEffect(() => {
    if (hideUntilLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const [headRaw, workingRaw] = await Promise.all([
          gitApi.fileHeadContent(path).catch(() => null),
          fsApi
            .readFileText(path, LARGE_DIFF_CHARS)
            .then((r) => r.content)
            .catch(() => ""),
        ]);
        if (cancelled) return;
        const head = headRaw ?? "";
        const working = workingRaw ?? "";
        if (!loaded && head.length + working.length >= LARGE_DIFF_CHARS) {
          setDiscoveredLarge(true);
          return;
        }
        const diff = collapseUnchanged(diffLines(head, working));
        setRows(diff.slice(0, PREVIEW_MAX_ROWS));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hideUntilLoaded, loaded, path]);

  if (hideUntilLoaded) {
    return <LargeDiffPlaceholder onLoad={() => markLoaded(projectId, path)} />;
  }
  if (error) {
    return <p className="px-12px py-8px text-caption text-danger">{error}</p>;
  }
  if (!rows) {
    return (
      <p className="px-12px py-8px font-mono text-caption text-muted">{t("common.loading")}</p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="px-12px py-8px text-caption text-muted">{t("diff.identical")}</p>
    );
  }

  return (
    <div className="overflow-x-auto border-t border-hairline-soft bg-canvas-soft font-mono text-micro leading-[18px]">
      {rows.map((row, idx) => (
        <div
          key={`${idx}:${row.type}`}
          className={cn(
            "grid grid-cols-[28px_minmax(0,1fr)] px-8px",
            row.type === "add" && "bg-success/15 text-success",
            row.type === "del" && "bg-danger/12 text-danger",
            row.type === "eq" && "text-muted",
          )}
        >
          <span className="select-none text-right text-muted-soft">{idx + 1}</span>
          <span className="min-w-0 whitespace-pre px-8px">{row.text || " "}</span>
        </div>
      ))}
    </div>
  );
}
