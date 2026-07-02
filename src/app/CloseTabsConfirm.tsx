import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { PendingClose } from "@/app/appShell.helpers";

interface CloseTabsConfirmProps {
  state: PendingClose | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CloseTabsConfirm({ state, onConfirm, onCancel }: CloseTabsConfirmProps) {
  const { t } = useTranslation();
  const open = state !== null;
  const copy = state ? confirmCopyFor(state, t) : null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      tone="destructive"
      title={copy?.title ?? ""}
      description={copy?.description}
      details={copy?.details}
      confirmLabel={copy?.confirm ?? t("appShell.closeFallbackConfirm")}
      cancelLabel={t("common.cancel")}
      onConfirm={onConfirm}
    />
  );
}

function confirmCopyFor(
  s: PendingClose,
  t: TFunction,
): {
  title: string;
  description: string;
  details?: ReactNode;
  confirm: string;
} {
  if (s.mode === "single" && s.singleTab) {
    const tab = s.singleTab;
    const details =
      "cwd" in tab && tab.cwd ? (
        <span className="font-mono text-label text-muted-soft">{tab.cwd}</span>
      ) : null;
    if (tab.kind === "cli") {
      return {
        title: t("appShell.closeAgentTitle", { title: tab.title }),
        description: t("appShell.closeAgentDescription"),
        details,
        confirm: t("appShell.closeAgentConfirm"),
      };
    }
    return {
      title: t("appShell.closeTerminalTitle"),
      description: t("appShell.closeTerminalDescription"),
      details,
      confirm: t("appShell.closeTerminalConfirm"),
    };
  }

  const parts: string[] = [];
  if (s.terminals > 0) parts.push(t("appShell.terminalCount", { count: s.terminals }));
  if (s.agents > 0) parts.push(t("appShell.agentCount", { count: s.agents }));
  const inventory = parts.join(t("appShell.and"));

  const title =
    s.mode === "all" ? t("appShell.closeAllTitle") : t("appShell.closeOthersTitle");
  return {
    title,
    description: t("appShell.closeManyDescription", {
      inventory,
      count: s.terminals + s.agents,
    }),
    confirm: t("appShell.closeManyConfirm"),
  };
}
