import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { useToastStore, type Toast, type ToastTone } from "@/features/ui/toast.store";
import { cn } from "@/lib/cn";

const toneIcon: Record<ToastTone, typeof Info> = {
  info: Info,
  error: AlertCircle,
  success: CheckCircle2,
};

const toneAccent: Record<ToastTone, string> = {
  info: "text-ink",
  error: "text-danger",
  success: "text-ink",
};

function ToastRow({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    if (toast.durationMs <= 0) return;
    const h = window.setTimeout(() => dismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(h);
  }, [toast.id, toast.durationMs, dismiss]);

  return (
    <div
      role="status"
      className="pointer-events-auto flex w-[340px] items-start gap-[10px] rounded-lg border border-hairline bg-canvas/95 px-[14px] py-[11px] shadow-lg backdrop-blur-sm"
    >
      <Icon icon={toneIcon[toast.tone]} className={cn("mt-[1px] shrink-0", toneAccent[toast.tone])} size={16} />
      <div className="min-w-0 flex-1 space-y-[2px]">
        <p className="text-ui text-ink">{toast.title}</p>
        {toast.detail ? (
          <p className="break-words font-mono text-caption text-muted">{toast.detail}</p>
        ) : null}
      </div>
      <IconButton
        size="sm"
        aria-label={t("common.dismiss")}
        onClick={() => dismiss(toast.id)}
      >
        <Icon icon={X} size={14} />
      </IconButton>
    </div>
  );
}

/** Global toast outlet. Mounted once near the app root. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-[16px] right-[16px] z-[1000] flex flex-col gap-[8px]">
      {toasts.map((tst) => (
        <ToastRow key={tst.id} toast={tst} />
      ))}
    </div>
  );
}
