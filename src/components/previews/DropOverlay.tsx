import { FileDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * Visual feedback while a file is dragged over the window. Purely cosmetic — the
 * actual drop is handled by the global Tauri `onDragDropEvent` in AppShell. Never
 * carries `data-tauri-drag-region` (it must not become a window-drag surface).
 * Opacity-only fade per the app convention.
 */
export function DropOverlay({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      aria-hidden={!active}
      className={cn(
        "pointer-events-none absolute inset-[10px] z-[80] flex items-center justify-center",
        "rounded-lg border-2 border-dashed border-hairline-strong bg-scrim/40 backdrop-blur-[1px]",
        "transition-opacity duration-150",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="flex flex-col items-center gap-[8px] text-ink">
        <Icon icon={FileDown} size={26} strokeWidth={1.5} />
        <span className="text-[13px] font-medium tracking-tight">{t("preview.dropHint")}</span>
      </div>
    </div>
  );
}
