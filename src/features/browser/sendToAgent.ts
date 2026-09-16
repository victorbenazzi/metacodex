import { WORKSPACE_NULL, useTabsStore } from "@/components/tabs/tabsStore";
import { useProjectsStore } from "@/features/projects/project.store";
import { ptyApi } from "@/features/terminal/terminal.service";
import { useTerminalStore } from "@/features/terminal/terminal.store";
import { utf8ToBase64 } from "@/lib/base64";
import { isAppError } from "@/lib/ipc";

export type SendVisualResult =
  | { status: "sent"; sessionId: string; tabId: string | null }
  | { status: "no-cli" }
  | { status: "failed"; error: { code: string; message: string } };

/** Write visual context into a running CLI session. Never a plain shell. */
export type VisualTarget = { sessionId: string; tabId: string | null; projectKey: string };

export function resolveVisualTarget(): VisualTarget | null {
  const projectId = useProjectsStore.getState().activeProjectId;
  const projectKey = projectId ?? WORKSPACE_NULL;
  const term = useTerminalStore.getState();
  const runningCli = Object.values(term.sessions).filter(
    (session) =>
      session.status === "running" &&
      session.kind === "cli" &&
      (session.projectId ?? WORKSPACE_NULL) === projectKey,
  );
  const activeTabId = useTabsStore.getState().getBucket(projectKey).activeTabId;
  const lastId = term.getLastFocused(projectKey);
  const last = lastId ? term.getById(lastId) : undefined;
  const lastMatches =
    last &&
    last.status === "running" &&
    last.kind === "cli" &&
    (last.projectId ?? WORKSPACE_NULL) === projectKey;
  // The selected process owns delivery. An active terminal blocks fallback to another CLI.
  const target = activeTabId
    ? runningCli.find((session) => session.tabId === activeTabId)
    : (lastMatches ? last : runningCli[0]);
  return target ? { sessionId: target.id, tabId: target.tabId ?? null, projectKey } : null;
}

export async function sendVisualToCli(
  text: string,
  pinnedTarget: VisualTarget | null = resolveVisualTarget(),
): Promise<SendVisualResult> {
  if (!pinnedTarget) return { status: "no-cli" };
  const target = useTerminalStore.getState().getById(pinnedTarget.sessionId);
  if (!target || target.status !== "running" || target.kind !== "cli" ||
      (target.projectId ?? WORKSPACE_NULL) !== pinnedTarget.projectKey ||
      (target.tabId ?? null) !== pinnedTarget.tabId) {
    return { status: "no-cli" };
  }
  const payload = `${text.replace(/\s+$/, "")}\n`;
  try {
    await ptyApi.write(target.id, utf8ToBase64(payload));
  } catch (error) {
    return {
      status: "failed",
      error: isAppError(error)
        ? error
        : {
            code: "write_failed",
            message: error instanceof Error ? error.message : String(error),
          },
    };
  }
  // Delivery does not change the selection made while capture was pending.
  return { status: "sent", sessionId: target.id, tabId: target.tabId ?? null };
}

export function formatVisualContext(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}
