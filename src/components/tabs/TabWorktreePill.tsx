import { GitBranch } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { useWorktreesStore } from "@/features/git/worktrees.store";
import type { Tab } from "./types";

interface TabWorktreePillProps {
  tab: Tab;
}

/**
 * Tiny "⎇ branch" pill that lives next to the title when a terminal/cli tab
 * runs inside one of the project's git worktrees. Lets the user spot at a
 * glance which tab is editing what branch — the cmux "vertical sidebar with
 * branch per tab" condensed into a single chip.
 *
 * Returns null for everything that isn't a worktree-hosted process tab.
 */
export function TabWorktreePill({ tab }: TabWorktreePillProps) {
  const worktree = useWorktreesStore((s) => {
    if (tab.kind !== "terminal" && tab.kind !== "cli") return null;
    if (!tab.projectId) return null;
    const bucket = s.byProject[tab.projectId];
    if (!bucket) return null;
    return bucket.worktrees.find((w) => !w.isMain && w.path === tab.cwd) ?? null;
  });

  if (!worktree?.branch) return null;

  return (
    <span
      title={`worktree: ${worktree.branch}`}
      className="inline-flex max-w-[110px] shrink-0 items-center gap-[3px] rounded-xs border border-hairline px-[4px] py-[1px] font-mono text-[9px] tabular-nums text-muted"
    >
      <Icon icon={GitBranch} size={9} />
      <span className="truncate">{worktree.branch}</span>
    </span>
  );
}
