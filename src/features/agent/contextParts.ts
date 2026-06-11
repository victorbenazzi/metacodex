import { gitApi } from "@/features/git/git.service";
import { useAgentChatStore } from "./chat.store";
import { mapStoredMessage } from "./chat.events";
import { qs } from "./oc";

/**
 * Send-time materialization of the "@" context chips into synthetic text
 * parts: the current branch summary and a past chat's transcript digest.
 * Best-effort: a failed resolve drops the part rather than blocking the send.
 */

/** Branch context v1: name + ahead/behind + changed file list (a real patch
 *  needs a git diff command on the Rust side, follow-up). */
export async function branchContextText(root: string, branch: string): Promise<string | null> {
  try {
    const info = await gitApi.status(root);
    if (!info) return null;
    const name = info.branch ?? branch;
    const lines = Object.entries(info.statuses).map(([path, code]) => {
      const rel = path.startsWith(root) ? path.slice(root.length).replace(/^\/+/, "") : path;
      return `${code} ${rel}`;
    });
    const header =
      `Context: current git branch "${name}"` +
      (info.ahead || info.behind ? ` (ahead ${info.ahead}, behind ${info.behind})` : "");
    if (lines.length === 0) return `${header}. Working tree clean.`;
    return `${header}. Uncommitted changes vs HEAD:\n${lines.join("\n")}`;
  } catch {
    return null;
  }
}

/** Symbol context: a pointer the agent can follow (no inlined source, reading
 *  the file is the agent's own one-step job). Line shown 1-based. */
export async function symbolContextText(
  name: string,
  path: string,
  line: number,
): Promise<string | null> {
  const { directory } = useAgentChatStore.getState();
  const rel =
    directory && path.startsWith(`${directory}/`) ? path.slice(directory.length + 1) : path;
  return `Context: symbol "${name}" at ${rel}:${line + 1}. Read that file around the line for its definition.`;
}

const MAX_CHAT_CONTEXT_CHARS = 8 * 1024;
const MAX_CHAT_CONTEXT_MESSAGES = 20;

/** Past-chat context: the last messages' text, capped, wrapped with the title. */
export async function chatContextText(sessionId: string, title: string): Promise<string | null> {
  try {
    const { baseUrl, directory } = useAgentChatStore.getState();
    if (!baseUrl) return null;
    const res = await fetch(`${baseUrl}/session/${sessionId}/message${qs(directory)}`);
    if (!res.ok) return null;
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return null;
    const messages = rows
      .map(mapStoredMessage)
      .filter((m): m is NonNullable<typeof m> => !!m)
      .slice(-MAX_CHAT_CONTEXT_MESSAGES);
    const body = messages
      .map((m) => {
        const text = m.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n");
        return text ? `${m.role === "user" ? "User" : "Assistant"}: ${text}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
    if (!body) return null;
    const capped =
      body.length > MAX_CHAT_CONTEXT_CHARS
        ? `[earlier messages truncated]\n${body.slice(body.length - MAX_CHAT_CONTEXT_CHARS)}`
        : body;
    return `Context from past chat "${title}":\n${capped}`;
  } catch {
    return null;
  }
}
