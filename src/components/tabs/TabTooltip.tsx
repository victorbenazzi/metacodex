import { useTranslation } from "react-i18next";
import { GitBranch } from "@/components/ui/icons";

import { Icon } from "@/components/ui/Icon";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { useTabMetadataStore } from "@/features/terminal/tabMetadata.store";
import { resolveTabTitle, type Tab } from "./types";

interface TabTooltipProps {
  tab: Tab;
}

/**
 * Compact, hover-only summary card. Lives inside the Tooltip portal so it
 * inherits the system's exit animation (opacity-only fade).
 *
 * Information density tier list:
 *   1. Tab name (always).
 *   2. Branch: only when there is a git repo at the tab's cwd. The label is
 *      monospace because branch names contain `/` and `-` that read better in
 *      mono.
 *   3. cwd: relative-from-HOME when possible, else absolute, truncated middle
 *      so the basename is always visible.
 *   4. Listening ports: chips. Empty section is hidden.
 *
 * Skipped on file tabs (editor/markdown/image/pdf): they don't have a process
 * behind them; we leave the simple title-only tooltip alone elsewhere.
 */
export function TabTooltip({ tab }: TabTooltipProps) {
  const { t } = useTranslation();

  // For process tabs, look up the session for this tab id, then pull metadata.
  const sessionId = useTerminalStore((s) => {
    if (tab.kind !== "terminal" && tab.kind !== "cli") return null;
    for (const sess of Object.values(s.sessions)) {
      if (sess.tabId === tab.id) return sess.id;
    }
    return null;
  });
  const meta = useTabMetadataStore((s) => (sessionId ? s.bySessionId[sessionId] : undefined));

  // Show a discreet origin line when the displayed title isn't the default.
  // user-rename always wins over agent-rename in `resolveTabTitle`, so the
  // precedence here mirrors that.
  const titleOrigin = tab.userTitle
    ? "tabs.tooltipUserTitle"
    : tab.agentTitle
      ? "tabs.tooltipAgentTitle"
      : null;

  return (
    <div className="flex max-w-[320px] flex-col gap-6px">
      <span className="text-caption font-medium text-ink truncate">{resolveTabTitle(tab)}</span>
      {titleOrigin ? (
        <span className="text-micro text-muted-soft">{t(titleOrigin)}</span>
      ) : null}

      {meta?.branch ? (
        <span className="flex items-center gap-5px text-label text-body">
          <Icon icon={GitBranch} size={10} className="text-muted" />
          <span className="font-mono">{meta.branch}</span>
        </span>
      ) : null}

      {meta?.cwd ? (
        <span className="block truncate font-mono text-micro text-muted" title={meta.cwd}>
          {meta.cwd}
        </span>
      ) : "cwd" in tab && tab.cwd ? (
        <span className="block truncate font-mono text-micro text-muted" title={tab.cwd}>
          {tab.cwd}
        </span>
      ) : null}

      {meta && meta.listeningPorts.length > 0 ? (
        <div className="flex flex-wrap gap-4px">
          {meta.listeningPorts.map((p) => (
            <span
              key={`${p.protocol}-${p.port}`}
              className="inline-flex items-center rounded-xs border border-hairline px-5px py-[1px] font-mono text-micro tabular-nums text-body"
            >
              {p.address === "*" || p.address === "0.0.0.0" ? "localhost" : p.address}:
              {p.port}
            </span>
          ))}
        </div>
      ) : null}

      {meta == null && sessionId ? (
        <span className="text-micro text-muted-soft">{t("tabInspector.tooltip.noMetadata")}</span>
      ) : null}
    </div>
  );
}
