import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { CliTool } from "@/features/terminal/cli-registry";

interface ElevatedLaunchDialogProps {
  open: boolean;
  cli: CliTool;
  projectName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ElevatedLaunchDialog({
  open,
  cli,
  projectName,
  onOpenChange,
  onConfirm,
}: ElevatedLaunchDialogProps) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      title={t("cli.elevatedTitle", { label: cli.label })}
      description={t("cli.elevatedDescription", { project: projectName })}
      details={(
        <code className="block rounded-sm bg-surface-soft px-10px py-8px font-mono text-caption text-ink">
          {(cli.elevatedArgs ?? []).join(" ")}
        </code>
      )}
      confirmLabel={t("cli.elevatedConfirm")}
      onConfirm={onConfirm}
    />
  );
}
