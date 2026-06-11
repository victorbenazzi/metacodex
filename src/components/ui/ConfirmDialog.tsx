import { type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Additional rich content (lists, file paths) rendered below the description. */
  details?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive uses danger color and an explicit warning glyph. */
  tone?: "destructive" | "warning" | "neutral";
  onConfirm: () => void;
  /** If true, confirm button shows a spinner / is disabled. */
  pending?: boolean;
  /** Optional icon override (defaults to AlertTriangle for destructive/warning). */
  icon?: ReactNode;
  /** Optional opt-out checkbox shown below the description (e.g. "don't ask again in this session"). */
  skipOption?: {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
  };
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel,
  tone = "neutral",
  onConfirm,
  pending = false,
  icon,
  skipOption,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const showIcon = tone !== "neutral" || icon !== undefined;
  const iconNode =
    icon ??
    (tone === "destructive" ? (
      <Icon icon={AlertTriangle} size={14} className="text-danger" />
    ) : tone === "warning" ? (
      <Icon icon={AlertTriangle} size={14} className="text-warn" />
    ) : null);

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        width={420}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {cancelLabel ?? t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              className={cn(
                tone === "destructive" &&
                  "bg-danger text-on-primary hover:bg-danger/85 focus-visible:outline-danger",
                tone === "warning" &&
                  "bg-warn text-on-primary hover:bg-warn/85 focus-visible:outline-warn",
              )}
            >
              {confirmLabel ?? t("common.confirm")}
            </Button>
          </>
        }
      >
        <div className="flex gap-[12px]">
          {showIcon ? (
            <span
              aria-hidden
              className={cn(
                "mt-[1px] flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-pill",
                tone === "destructive" && "bg-danger/10",
                tone === "warning" && "bg-warn/10",
                tone === "neutral" && "bg-surface-strong/60",
              )}
            >
              {iconNode}
            </span>
          ) : null}
          <div className="flex-1 space-y-[8px]">
            {description ? (
              <p className="text-ui leading-relaxed text-body">
                {description}
              </p>
            ) : null}
            {details ? (
              <div className="text-caption text-muted">{details}</div>
            ) : null}
            {skipOption ? (
              <label
                className={cn(
                  "mt-[4px] flex cursor-pointer items-center gap-[8px] text-caption text-muted",
                  "select-none hover:text-body",
                )}
              >
                <input
                  type="checkbox"
                  checked={skipOption.checked}
                  onChange={(e) => skipOption.onChange(e.target.checked)}
                  className="h-[13px] w-[13px] accent-accent"
                />
                <span>{skipOption.label}</span>
              </label>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
