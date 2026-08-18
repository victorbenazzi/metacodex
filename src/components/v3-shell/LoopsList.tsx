import { RefreshCw } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { useLoopsStore } from "@/features/loops/loops.store";
import { cn } from "@/lib/cn";

export function LoopsList() {
  const { t } = useTranslation();
  const loops = useLoopsStore((s) => s.loops);
  const selectedId = useLoopsStore((s) => s.selectedId);
  const select = useLoopsStore((s) => s.select);

  if (loops.length === 0) {
    return (
      <div className="px-12px pt-8px">
        <p className="text-ui font-medium text-ink">{t("v3.loops.emptyTitle")}</p>
        <p className="mt-6px text-caption leading-[1.5] text-muted">{t("v3.loops.emptyBody")}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-[2px] px-6px">
      {loops.map((loop) => {
        const active = loop.id === selectedId;
        return (
          <li key={loop.id}>
            <button
              type="button"
              onClick={() => select(loop.id)}
              className={cn(
                "flex w-full items-start gap-8px rounded-sm px-8px py-8px text-left transition-colors duration-fast",
                active
                  ? "bg-surface-strong text-ink"
                  : "text-ink hover:bg-surface-strong/40",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
              )}
            >
              <Icon icon={RefreshCw} size={14} className="mt-[1px] shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-medium text-ink">
                  {loop.name ?? loop.id}
                </span>
                <span className="mt-[2px] block line-clamp-2 text-label text-muted-soft">
                  {loop.goal}
                </span>
                <span className="mt-4px block font-mono text-micro text-muted-soft">
                  {loop.makerKind} · {loop.verifyKind}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
