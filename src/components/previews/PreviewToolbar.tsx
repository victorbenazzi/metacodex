import { type ReactNode } from "react";
import { FolderInput } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/** Bridge to the AppShell-owned "send to project" flow (mirrors `sendToTerminal`). */
function sendToProject(path: string) {
  (
    window as unknown as { __metacodex?: { sendToProject?: (p: string) => void } }
  ).__metacodex?.sendToProject?.(path);
}

/** "Send to project" action, used inside preview tab headers. */
export function SendToProjectButton({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => sendToProject(path)}
      className={cn(
        "inline-flex h-[22px] items-center gap-[6px] rounded-xs px-[8px] text-label text-muted",
        "hover:bg-surface-strong/55 hover:text-ink",
        className,
      )}
    >
      <Icon icon={FolderInput} size={12} />
      {t("preview.sendToProject")}
    </button>
  );
}

/**
 * Lightweight 34px chrome for preview tabs that have no header of their own
 * (the code editor). Shows a "Preview" badge (signals the file is unregistered
 * and ephemeral) plus the send-to-project action. `right` slots extra controls.
 */
export function PreviewToolbar({ path, right }: { path: string; right?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header
      data-tauri-drag-region
      className="flex h-[34px] shrink-0 items-center justify-between border-b border-hairline-soft px-[14px]"
    >
      <span className="editorial-caps text-muted">{t("preview.badge")}</span>
      <div className="flex items-center gap-[6px]">
        {right}
        <SendToProjectButton path={path} />
      </div>
    </header>
  );
}
