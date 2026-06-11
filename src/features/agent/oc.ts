import { mapStoredMessage } from "./chat.events";
import type { SessionFileDiff } from "./opencode";

/**
 * Shared low-level helpers for talking to the opencode sidecar over HTTP.
 * Single owners of the `?directory=` invariant, the error-to-string mapping
 * and the throwaway one-shot prompt dance, so they can't drift across the
 * chat store, the sessions mirror, the vision relay and "create from chat".
 */

/** `?directory=` query string for a path-scoped opencode call. */
export function qs(directory: string | null): string {
  return directory ? `?directory=${encodeURIComponent(directory)}` : "";
}

/**
 * Query string carrying `directory` plus extra params with a single `?`.
 * `qs()` always opens its own `?`, so any endpoint that needs more params
 * (find, command) must build through here instead of concatenating by hand.
 */
export function qsx(
  directory: string | null,
  params: Record<string, string | undefined>,
): string {
  const sp = new URLSearchParams();
  if (directory) sp.set("directory", directory);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, v);
  }
  const out = sp.toString();
  return out ? `?${out}` : "";
}

export function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Fire-and-forget archive so a throwaway session never pollutes the sidebar
 *  history. `metadata.throwaway` keeps these machine-made one-shots out of the
 *  user's "Archived" list too (which shows only what the USER archived). */
export function archiveSession(base: string, directory: string | null, id: string): void {
  void fetch(`${base}/session/${id}${qs(directory)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ time: { archived: Date.now() }, metadata: { throwaway: true } }),
  }).catch(() => undefined);
}

/**
 * Accumulated file changes of a session (`GET /session/{id}/diff`, an array of
 * `SnapshotFileDiff`). Pass `messageID` to scope the diff to a single user
 * message. Null on any failure, so callers render their error state instead
 * of an empty diff.
 */
export async function fetchSessionDiff(
  base: string,
  directory: string | null,
  sessionId: string,
  messageID?: string,
): Promise<SessionFileDiff[] | null> {
  try {
    const res = await fetch(`${base}/session/${sessionId}/diff${qsx(directory, { messageID })}`);
    if (!res.ok) return null;
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return null;
    return rows
      .map((r) => r as Record<string, unknown>)
      .filter((r) => typeof r.file === "string" && r.file)
      .map((r) => ({
        file: r.file as string,
        additions: typeof r.additions === "number" ? r.additions : 0,
        deletions: typeof r.deletions === "number" ? r.deletions : 0,
        ...(typeof r.patch === "string" ? { patch: r.patch } : {}),
        ...(typeof r.status === "string" ? { status: r.status } : {}),
      }));
  } catch {
    return null;
  }
}

export interface OneShotOptions {
  /** opencode message parts, sent as-is (file parts first per convention). */
  parts: unknown[];
  model: { providerID: string; modelID: string };
  system?: string;
}

/**
 * Run a single prompt in a fresh throwaway session and return the assistant's
 * text reply (null on any failure). The message POST blocks until the turn
 * ends, so the follow-up GET reads a complete transcript. The session is
 * archived in a `finally`, covering every failure path, so one-shots never
 * leak into the project's chat history.
 */
export async function oneShotPrompt(
  base: string,
  directory: string | null,
  opts: OneShotOptions,
): Promise<string | null> {
  const q = qs(directory);
  let sessionId: string | null = null;
  try {
    const session = (await (
      await fetch(`${base}/session${q}`, { method: "POST", headers: JSON_HEADERS, body: "{}" })
    ).json()) as { id?: string };
    if (!session.id) return null;
    sessionId = session.id;

    const res = await fetch(`${base}/session/${sessionId}/message${q}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        parts: opts.parts,
        model: opts.model,
        ...(opts.system ? { system: opts.system } : {}),
      }),
    });
    if (!res.ok) return null;
    await res.json().catch(() => undefined);

    const rows = (await (
      await fetch(`${base}/session/${sessionId}/message${q}`)
    ).json()) as unknown;
    const messages = Array.isArray(rows) ? rows.map(mapStoredMessage) : [];
    const reply = [...messages].reverse().find((m) => m?.role === "assistant");
    const text = (reply?.parts ?? [])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("")
      .trim();
    return text || null;
  } catch {
    return null;
  } finally {
    if (sessionId) archiveSession(base, directory, sessionId);
  }
}
