import type { ResumeEntry } from "./resume.service";
import { resumeFlagFor } from "./sessionDetectors";
import { cliById, cliLaunchString } from "@/features/terminal/cli-registry";
import type { Tab } from "@/components/tabs/types";
import { newId } from "@/lib/idGen";
import { isWindows } from "@/lib/platform";

/**
 * Build a `Tab` descriptor that, when opened, spawns the CLI with its resume
 * flag pointing at the captured session id. The cwd is whatever the resume
 * entry recorded — typically the agent's worktree or the project root at the
 * time of capture.
 *
 * Returns null when the CLI is unknown or doesn't support resume (so callers
 * can hide the button cleanly).
 */
export function buildResumeTab(entry: ResumeEntry): Tab | null {
  const cli = cliById(entry.cliId);
  if (!cli) return null;
  const flag = resumeFlagFor(entry.cliId);
  if (!flag) return null;
  const base = cliLaunchString(cli);
  const launchCommand = `${base} ${flag} ${shellEscape(entry.sessionId)}`;
  return {
    id: `c-${newId(10)}`,
    kind: "cli",
    title: `${cli.label} · resumed`,
    projectId: entry.projectId,
    cwd: entry.cwd,
    cliId: entry.cliId,
    launchCommand,
  };
}

function shellEscape(value: string): string {
  if (isWindows) {
    // PowerShell single-quoted strings escape an interior quote by doubling
    // it: `'it''s'`. No backslash escaping — single quotes inhibit ALL
    // variable / backtick interpretation, which is what we want for a raw
    // session id passed to `--resume`.
    return `'${value.replace(/'/g, "''")}'`;
  }
  // Conservative: single-quote everything, escaping embedded quotes by closing
  // the quote, inserting `\'` and reopening. Works in bash/zsh/sh.
  return `'${value.replace(/'/g, "'\\''")}'`;
}
