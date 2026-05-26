import { useEffect, useState } from "react";
import { GitBranch, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownContent,
  DropdownRoot,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { Tooltip } from "@/components/ui/Tooltip";
import { Kbd } from "@/components/ui/Kbd";
import { Icon } from "@/components/ui/Icon";
import { useSourceControlStore } from "@/features/source-control/sourceControl.store";
import { useGitStore } from "@/features/git/git.store";
import { useProjectsStore } from "@/features/projects/project.store";
import type { CliTool } from "@/features/terminal/cli-registry";
import { cn } from "@/lib/cn";
import { DROPDOWN_COMPONENTS, NewTabBody } from "./NewTabMenu";

interface TabTrailingActionsProps {
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
  onEditRegistry?: () => void;
  onNewWorktree?: () => void;
}

/**
 * Pill-shaped group living at the right end of the tab bar. Bundles the
 * Source Control panel toggle (with a change-count badge) and the "+" new-tab
 * dropdown into a single rounded card with a hairline border — same visual
 * language as Linear / Vercel's segmented action groups.
 *
 * The SC toggle is hidden when there's no active project (its store is global,
 * but the panel itself is project-scoped). The "+" always shows.
 */
export function TabTrailingActions({
  onNewTerminal,
  onLaunchCli,
  onEditRegistry,
  onNewWorktree,
}: TabTrailingActionsProps) {
  const { t } = useTranslation();
  const panelOpen = useSourceControlStore((s) => s.open);
  const togglePanel = useSourceControlStore((s) => s.toggle);
  const activeId = useProjectsStore((s) => s.activeProjectId);
  const git = useGitStore((s) => (activeId ? s.byProject[activeId] : null));
  const changeCount = git ? Object.keys(git.statuses).length : 0;
  // Avoid hydrating the SC toggle before the projects store is ready — would
  // otherwise pop in/out as `activeProjectId` resolves on cold start.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const showSc = mounted && !!activeId;

  return (
    <div
      className={cn(
        "inline-flex h-[24px] items-stretch overflow-hidden rounded-sm border border-hairline bg-canvas/70",
      )}
    >
      <DropdownRoot>
        <Tooltip
          content={t("tabs.newTab")}
          shortcut={<Kbd keys={["Mod", "T"]} />}
          side="bottom"
        >
          <DropdownTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex w-[28px] items-center justify-center text-muted transition-colors",
                "hover:bg-surface-strong/45 hover:text-ink",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
              )}
              aria-label={t("tabs.newTab")}
            >
              <Icon icon={Plus} size={12} />
            </button>
          </DropdownTrigger>
        </Tooltip>
        <DropdownContent align="end" sideOffset={8}>
          <NewTabBody
            actions={{ onNewTerminal, onLaunchCli, onEditRegistry, onNewWorktree }}
            C={DROPDOWN_COMPONENTS}
          />
        </DropdownContent>
      </DropdownRoot>
      {showSc ? (
        <>
          <span className="w-px self-stretch bg-hairline" aria-hidden="true" />
          <Tooltip content={t("sourceControl.toggle")} side="bottom">
            <button
              type="button"
              onClick={togglePanel}
              aria-label={t("sourceControl.toggle")}
              aria-pressed={panelOpen}
              className={cn(
                "inline-flex items-center gap-[5px] px-[8px] font-mono text-[10px] leading-none tabular-nums transition-colors duration-[var(--dur-fast)]",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong",
                panelOpen
                  ? "bg-surface-strong/70 text-ink"
                  : "text-muted hover:bg-surface-strong/45 hover:text-body",
              )}
            >
              <Icon icon={GitBranch} size={12} strokeWidth={1.75} />
              {changeCount > 0 ? (
                <span>{changeCount > 99 ? "99+" : changeCount}</span>
              ) : null}
            </button>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}
