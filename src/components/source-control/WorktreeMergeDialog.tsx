import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DialogContent, DialogRoot } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { MergeStrategy, WorktreeInfo } from "@/features/git/worktrees.service";

interface WorktreeMergeDialogProps {
  worktree: WorktreeInfo | null;
  onCancel: () => void;
  onConfirm: (strategy: MergeStrategy) => void;
}

const STRATEGIES: { id: MergeStrategy; titleKey: string; hintKey: string }[] = [
  {
    id: "ff-only",
    titleKey: "worktrees.merge.strategy.ffOnly",
    hintKey: "worktrees.merge.strategy.ffOnlyHint",
  },
  {
    id: "merge",
    titleKey: "worktrees.merge.strategy.merge",
    hintKey: "worktrees.merge.strategy.mergeHint",
  },
  {
    id: "squash",
    titleKey: "worktrees.merge.strategy.squash",
    hintKey: "worktrees.merge.strategy.squashHint",
  },
];

export function WorktreeMergeDialog({
  worktree,
  onCancel,
  onConfirm,
}: WorktreeMergeDialogProps) {
  const { t } = useTranslation();
  const [strategy, setStrategy] = useState<MergeStrategy>("ff-only");
  const branch = worktree?.branch ?? "";

  return (
    <DialogRoot open={!!worktree} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        title={t("worktrees.merge.title", { branch }) as string}
        description={t("worktrees.merge.description") as string}
        width={460}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={() => onConfirm(strategy)}>
              {t("worktrees.merge.confirm")}
            </Button>
          </>
        }
      >
        <div role="radiogroup" className="flex flex-col gap-8px">
          {STRATEGIES.map((s) => {
            const active = strategy === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setStrategy(s.id)}
                className={cn(
                  "flex flex-col gap-[2px] rounded-sm border px-12px py-8px text-left transition-colors",
                  active
                    ? "border-ink bg-surface-strong/35"
                    : "border-hairline-strong hover:bg-surface-strong/25",
                )}
              >
                <span className="text-caption font-medium text-ink">{t(s.titleKey)}</span>
                <span className="text-label text-muted">{t(s.hintKey)}</span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
