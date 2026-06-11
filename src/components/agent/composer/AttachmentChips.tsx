import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Braces,
  FileText,
  Folder,
  GitBranch,
  Loader2,
  MessageSquare,
  X,
} from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useAgentComposerStore } from "@/features/agent/composer.store";
import type { PendingAttachment } from "@/features/agent/attachments";

/**
 * Pending attachment chips above the composer textarea: image thumbnails,
 * file/folder names, and @-context chips (branch, past chat). Each removable;
 * loading and error states render inline so a broken attachment never sends
 * silently.
 */
export function AttachmentChips() {
  const attachments = useAgentComposerStore((s) => s.attachments);
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-[6px] px-[12px] pt-[10px]">
      {attachments.map((a) => (
        <Chip key={a.id} attachment={a} />
      ))}
    </div>
  );
}

function Chip({ attachment }: { attachment: PendingAttachment }) {
  const { t } = useTranslation();
  const remove = useAgentComposerStore((s) => s.remove);

  const error = "status" in attachment && attachment.status === "error";
  const loading = "status" in attachment && attachment.status === "loading";

  return (
    <div
      className={cn(
        "group/chip relative flex max-w-[220px] items-center gap-[6px] rounded-md border border-hairline bg-surface-2 py-[4px] pl-[6px] pr-[22px] text-[12px] text-ink",
        error && "border-danger/40 text-danger",
      )}
    >
      <ChipVisual attachment={attachment} loading={loading} error={error} />
      <span className="min-w-0 truncate">{chipLabel(attachment)}</span>
      {error ? (
        <span className="shrink-0 whitespace-nowrap text-[11px] opacity-80">
          {t(errorKey(attachment))}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => remove(attachment.id)}
        aria-label={t("agent.composer.removeAttachment")}
        className="absolute right-[4px] top-1/2 -translate-y-1/2 rounded-sm p-[2px] text-muted opacity-60 hover:bg-surface-strong hover:text-ink hover:opacity-100"
      >
        <Icon icon={X} size={11} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function ChipVisual({
  attachment,
  loading,
  error,
}: {
  attachment: PendingAttachment;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <Icon icon={Loader2} size={13} className="shrink-0 animate-spin text-muted" />;
  }
  if (error) {
    return <Icon icon={AlertCircle} size={13} className="shrink-0" />;
  }
  if (attachment.kind === "image" && attachment.dataUrl) {
    return (
      <img
        src={attachment.dataUrl}
        alt=""
        draggable={false}
        className="h-[24px] w-[24px] shrink-0 rounded-sm border border-hairline-soft object-cover"
      />
    );
  }
  const icon =
    attachment.kind === "context-branch"
      ? GitBranch
      : attachment.kind === "context-chat"
        ? MessageSquare
        : attachment.kind === "context-symbol"
          ? Braces
          : attachment.kind === "file" && attachment.isDir
            ? Folder
            : FileText;
  return <Icon icon={icon} size={13} className="shrink-0 text-muted" />;
}

function chipLabel(a: PendingAttachment): string {
  switch (a.kind) {
    case "image":
    case "file":
      return a.filename;
    case "context-branch":
      return a.branch;
    case "context-chat":
      return a.title;
    case "context-symbol":
      return a.name;
  }
}

function errorKey(a: PendingAttachment): string {
  const err = "error" in a ? a.error : undefined;
  if (err === "too-large") return "agent.composer.attachmentTooLarge";
  if (err === "unsupported") return "agent.composer.attachmentUnsupported";
  return "agent.composer.attachmentError";
}
