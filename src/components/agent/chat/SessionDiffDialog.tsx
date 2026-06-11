import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDiff } from "lucide-react";

import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { fetchSessionDiff } from "@/features/agent/oc";
import type { SessionFileDiff } from "@/features/agent/opencode";
import { highlightToHtml } from "@/features/theme/shikiHighlighter";
import { useThemeStore } from "@/features/theme/theme.store";

/** Past this, a single file's patch is cut and a truncation note shows. */
const MAX_PATCH_CHARS = 64_000;

/**
 * The session's accumulated file changes (`GET /session/{id}/diff`), rendered
 * as one unified patch per file inside the Agent View, so checking what the
 * agent touched never forces a jump to the Code view. Shared by the revert
 * flow and the "N files changed" chip.
 */
export function SessionDiffDialog({
  open,
  onOpenChange,
  sessionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
}) {
  const { t } = useTranslation();
  const directory = useAgentChatStore((s) => s.directory);
  const [files, setFiles] = useState<SessionFileDiff[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFiles(null);
    setFailed(false);
    let alive = true;
    const { baseUrl, directory: dir } = useAgentChatStore.getState();
    if (!baseUrl) {
      setFailed(true);
      return;
    }
    void fetchSessionDiff(baseUrl, dir, sessionId).then((rows) => {
      if (!alive) return;
      if (rows === null) setFailed(true);
      else setFiles(rows);
    });
    return () => {
      alive = false;
    };
  }, [open, sessionId]);

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("agent.diff.title")} width={720}>
        <div className="max-h-[60vh] space-y-[14px] overflow-y-auto">
          {failed ? (
            <p className="text-[12px] text-danger">{t("agent.diff.failed")}</p>
          ) : files === null ? (
            <DiffSkeleton />
          ) : files.length === 0 ? (
            <EmptyState icon={FileDiff} title={t("agent.diff.empty")} />
          ) : (
            files.map((f) => <FileSection key={f.file} entry={f} root={directory} />)
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function FileSection({ entry, root }: { entry: SessionFileDiff; root: string | null }) {
  const { t } = useTranslation();
  return (
    <section className="overflow-hidden rounded-lg border border-hairline">
      <header className="flex items-center gap-[8px] border-b border-hairline-soft bg-surface-1 px-[12px] py-[7px]">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
          {relPath(entry.file, root)}
        </span>
        {entry.additions > 0 ? (
          <span className="shrink-0 font-mono text-[11px] text-success">+{entry.additions}</span>
        ) : null}
        {entry.deletions > 0 ? (
          <span className="shrink-0 font-mono text-[11px] text-danger">-{entry.deletions}</span>
        ) : null}
      </header>
      {entry.patch ? (
        <DiffBlock patch={entry.patch} />
      ) : (
        <p className="px-[12px] py-[8px] text-[12px] text-muted-soft">
          {t("agent.diff.noPatch")}
        </p>
      )}
    </section>
  );
}

/** One unified patch, coloured by the shared shiki engine (lang `diff`). Plain
 *  `<pre>` while the engine warms up or if highlighting fails. */
function DiffBlock({ patch }: { patch: string }) {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const [html, setHtml] = useState<string | null>(null);
  const truncated = patch.length > MAX_PATCH_CHARS;
  const code = truncated ? patch.slice(0, MAX_PATCH_CHARS) : patch;

  useEffect(() => {
    let alive = true;
    setHtml(null);
    highlightToHtml(code, "diff", theme)
      .then((out) => {
        if (alive) setHtml(out);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [code, theme]);

  return (
    <div className="max-w-full overflow-x-auto text-[11.5px] leading-[1.5] [&_pre]:m-0 [&_pre]:px-[12px] [&_pre]:py-[8px] [&_pre]:font-mono">
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="whitespace-pre px-[12px] py-[8px] font-mono">{code}</pre>
      )}
      {truncated ? (
        <p className="px-[12px] py-[6px] text-[11px] text-muted-soft">
          {t("agent.diff.truncated")}
        </p>
      ) : null}
    </div>
  );
}

function DiffSkeleton() {
  return (
    <div className="flex flex-col gap-[8px]" aria-hidden>
      <div className="h-[14px] w-[55%] rounded-md bg-surface-2 opacity-60" />
      <div className="h-[80px] w-full rounded-lg bg-surface-2 opacity-40" />
      <div className="h-[14px] w-[40%] rounded-md bg-surface-2 opacity-50" />
      <div className="h-[60px] w-full rounded-lg bg-surface-2 opacity-30" />
    </div>
  );
}

/** Show paths relative to the project root whenever they live under it. */
export function relPath(p: string, root: string | null): string {
  if (!root) return p;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}
