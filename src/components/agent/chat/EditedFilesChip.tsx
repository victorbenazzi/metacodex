import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDiff } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { SessionDiffDialog } from "./SessionDiffDialog";

/**
 * Discreet "N files changed" line at the tail of the thread; answers "what did
 * the agent touch?" without hunting tool chips. Click opens the session diff.
 * Grows live as `file.edited` events land and survives reopening a historical
 * session (rehydrated from the transcript's edit/write tool calls).
 */
export function EditedFilesChip() {
  const { t } = useTranslation();
  const editedFiles = useAgentChatStore((s) => s.editedFiles);
  const sessionId = useAgentChatStore((s) => s.sessionId);
  const [open, setOpen] = useState(false);

  if (!sessionId || editedFiles.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("agent.chat.viewDiff")}
        className="-mx-[4px] flex items-center gap-[6px] self-start rounded-md px-[4px] py-[2px] text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink"
      >
        <Icon icon={FileDiff} size={13} className="shrink-0 text-muted-soft" />
        {t("agent.chat.filesChanged", { count: editedFiles.length })}
      </button>
      <SessionDiffDialog open={open} onOpenChange={setOpen} sessionId={sessionId} />
    </>
  );
}
