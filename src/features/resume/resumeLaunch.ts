import type { ResumeEntry } from "./resume.service";
import { resumeArgsFor } from "./sessionDetectors";
import { cliById, cliLaunchString } from "@/features/terminal/cli-registry";
import type { CliTabT, Tab } from "@/components/tabs/types";
import { newId } from "@/lib/idGen";
import { isWindows } from "@/lib/platform";

/**
 * Build a `Tab` descriptor that, when opened, spawns the CLI with its resume
 * invocation pointing at the captured session id. The cwd is whatever the
 * resume entry recorded, typically the agent's worktree or the project root
 * at the time of capture.
 *
 * Returns null when the CLI is unknown or doesn't support resume (so callers
 * can hide the button cleanly).
 */
export function buildResumeTab(entry: ResumeEntry): CliTabT | null {
  const cli = cliById(entry.cliId);
  if (!cli) return null;
  const extra = resumeArgsFor(entry.cliId, entry.sessionId);
  if (!extra) return null;
  const base = cliLaunchString(cli);
  const tokens = extra.slice(0, -1);
  const sessionToken = extra[extra.length - 1] ?? "";
  const launchCommand = [base, ...tokens, shellEscape(sessionToken)].join(" ");
  return {
    id: `c-${newId(10)}`,
    kind: "cli",
    title: `${cli.label} · resumed`,
    projectId: entry.projectId,
    cwd: entry.cwd,
    cliId: entry.cliId,
    launchCommand,
    launchExecutable: cli.command,
    launchArgs: [...cli.args, ...extra],
  };
}

/** Dense sidebar label: CLI name, plus branch when we captured one. */
export function resumeHistoryLabel(entry: ResumeEntry): string {
  const cli = cliById(entry.cliId);
  const name = cli?.label ?? entry.cliId;
  return entry.branch ? `${name} · ${entry.branch}` : name;
}

/** True when a live CLI tab is already that captured session (not merely the same tool). */
export function isLiveResumeSession(tab: Tab, entry: ResumeEntry): boolean {
  if (tab.kind !== "cli" || tab.cliId !== entry.cliId) return false;
  if (tab.providerSessionId) return tab.providerSessionId === entry.sessionId;
  if (entry.sessionId.length > 0 && tab.launchCommand.includes(entry.sessionId)) {
    return true;
  }
  return entry.sessionId.length === 0 && tab.cwd === entry.cwd;
}

function shellEscape(value: string): string {
  if (isWindows) {
    // PowerShell single-quoted strings escape an interior quote by doubling
    // it: `'it''s'`. No backslash escaping, single quotes inhibit ALL
    // variable / backtick interpretation, which is what we want for a raw
    // session id passed to resume.
    return `'${value.replace(/'/g, "''")}'`;
  }
  // Conservative: single-quote everything, escaping embedded quotes by closing
  // the quote, inserting `\'` and reopening. Works in bash/zsh/sh.
  return `'${value.replace(/'/g, "'\\''")}'`;
}
