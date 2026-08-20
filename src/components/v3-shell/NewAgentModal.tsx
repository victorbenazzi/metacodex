import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { SquareTerminal } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import {
  PaletteHint,
  PaletteRow,
  PaletteSection,
  PaletteSheet,
} from "@/components/v3-shell/PaletteSheet";
import { useV3ShellStore } from "@/features/v3-shell/v3Shell.store";
import type { CliTool } from "@/features/terminal/cli-registry";
import { useEnabledCliTools } from "@/features/terminal/useEnabledCliTools";
import { fuzzyScore } from "@/lib/fuzzy";
import { ElevatedLaunchDialog } from "@/components/terminal/ElevatedLaunchDialog";

type AgentPick =
  | { kind: "terminal" }
  | { kind: "cli"; cli: CliTool }
  | { kind: "elevated"; cli: CliTool };

interface NewAgentModalProps {
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool, options?: { elevated?: boolean }) => void;
  projectPath: string;
}

export function NewAgentModal({ onNewTerminal, onLaunchCli, projectPath }: NewAgentModalProps) {
  const { t } = useTranslation();
  const open = useV3ShellStore((s) => s.newAgentOpen);
  const setOpen = useV3ShellStore((s) => s.setNewAgentOpen);
  const enabledCliTools = useEnabledCliTools();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pendingElevated, setPendingElevated] = useState<CliTool | null>(null);

  const items = useMemo(() => {
    const rows: AgentPick[] = [{ kind: "terminal" }];
    for (const cli of enabledCliTools) {
      rows.push({ kind: "cli", cli });
      if (cli.elevatedArgs?.length) rows.push({ kind: "elevated", cli });
    }
    const q = query.trim();
    if (!q) return rows;
    return rows
      .map((row) => ({ row, score: fuzzyScore(q, labelOf(row)) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.row);
  }, [enabledCliTools, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const choose = (index: number) => {
    const pick = items[index];
    if (!pick) return;
    setOpen(false);
    if (pick.kind === "terminal") onNewTerminal();
    else if (pick.kind === "elevated") setPendingElevated(pick.cli);
    else onLaunchCli(pick.cli);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  };

  return (
    <>
      <PaletteSheet
        open={open}
        onOpenChange={setOpen}
        title={t("v3.newAgent.title")}
        placeholder={t("v3.newAgent.search")}
        query={query}
        onQueryChange={setQuery}
        onKeyDown={onKeyDown}
        footer={
          <>
            <PaletteHint keys={["↑", "↓"]} label={t("v3.palette.navigate")} />
            <PaletteHint keys={["↵"]} label={t("v3.palette.select")} />
            <PaletteHint keys={["esc"]} label={t("v3.palette.close")} />
          </>
        }
      >
        {items.length === 0 ? (
          <p className="px-10px py-12px text-caption text-muted">
            {t("v3.palette.nothingFound")}
          </p>
        ) : (
          <>
            <PaletteSection label={t("v3.newAgent.section")} />
            {items.map((pick, i) => {
              if (pick.kind === "terminal") {
                return (
                  <PaletteRow
                    key="terminal"
                    active={i === active}
                    icon={<Icon icon={SquareTerminal} size={14} />}
                    label={t("tabs.newTerminal")}
                    description={t("v3.newAgent.terminalHint")}
                    onHover={() => setActive(i)}
                    onClick={() => choose(i)}
                  />
                );
              }
              const Brand = CLI_BRAND_ICONS[pick.cli.id];
              const elevated = pick.kind === "elevated";
              return (
                <PaletteRow
                  key={`${pick.cli.id}:${pick.kind}`}
                  active={i === active}
                  icon={Brand ? <Brand size={14} /> : <Icon icon={SquareTerminal} size={14} />}
                  label={
                    elevated
                      ? t("cli.elevatedAction", { label: pick.cli.label })
                      : pick.cli.label
                  }
                  description={elevated ? t("cli.elevatedActionHint") : pick.cli.description}
                  trailing={
                    pick.cli.needsConfig ? (
                      <span className="rounded-pill bg-warn/20 px-7px py-[2px] font-mono text-micro text-warn">
                        {t("cli.needsConfig")}
                      </span>
                    ) : undefined
                  }
                  onHover={() => setActive(i)}
                  onClick={() => choose(i)}
                />
              );
            })}
          </>
        )}
      </PaletteSheet>
      {pendingElevated ? (
        <ElevatedLaunchDialog
          open
          cli={pendingElevated}
          projectName={projectPath}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setPendingElevated(null);
          }}
          onConfirm={() => {
            const cli = pendingElevated;
            setPendingElevated(null);
            onLaunchCli(cli, { elevated: true });
          }}
        />
      ) : null}
    </>
  );
}

function labelOf(pick: AgentPick): string {
  return pick.kind === "terminal"
    ? "terminal"
    : `${pick.cli.label} ${pick.cli.id} ${pick.cli.description} ${pick.kind}`;
}
