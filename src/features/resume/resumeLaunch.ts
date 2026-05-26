import type { ResumeEntry } from "./resume.service";
import { resumeFlagFor } from "./sessionDetectors";
import { cliById, cliLaunchString } from "@/features/terminal/cli-registry";
import type { Tab } from "@/components/tabs/types";
import { newId } from "@/lib/idGen";

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
  // Conservative: single-quote everything, escaping embedded quotes by closing
  // the quote, inserting `\'` and reopening. Works in bash/zsh/sh.
  return `'${value.replace(/'/g, "'\\''")}'`;
}
