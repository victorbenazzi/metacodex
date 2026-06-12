import { extractJsonOneShot } from "./oc";

/**
 * Natural-language → scheduled-task extraction. Runs a throwaway one-shot turn
 * on the opencode runtime (`oc.extractJsonOneShot`, which archives the session
 * on every path) asking the model to emit a strict JSON task descriptor, then
 * parses it. This is the "Create from chat" path: the result prefills the
 * Create dialog for the user to review and save (never auto-saved), so a model
 * miss is harmless. No agent / tools: pure text in, JSON out.
 */

export type ExtractResult =
  | { ok: true; title: string; prompt: string; cron: string }
  | { ok: false; error: string };

const SYSTEM_INSTRUCTION = [
  "You turn a user's request into a recurring scheduled task for a coding agent.",
  "Respond with ONLY a single minified JSON object, no prose and no markdown fence:",
  '{"title": string, "prompt": string, "cron": string}',
  '- "title": a short label, max 50 chars, in the user\'s language.',
  '- "prompt": the full self-contained instruction the agent runs every time, in the user\'s language.',
  '- "cron": a STANDARD 5-field cron expression (minute hour day-of-month month day-of-week) in the user\'s LOCAL time.',
  "  Use */n, ranges (a-b) and lists (a,b) as needed. If no time is given, default to 09:00.",
  'Examples: daily 9am -> "0 9 * * *"; weekdays 18:30 -> "30 18 * * 1-5"; every 15 min -> "*/15 * * * *"; 1st of month 8am -> "0 8 1 * *".',
].join("\n");

export async function extractScheduledTask(
  request: string,
  directory?: string | null,
): Promise<ExtractResult> {
  // `directory` flows into the one-shot so the extractor sees the project
  // context (CLAUDE.md/AGENTS.md), producing project-aware prompts.
  const result = await extractJsonOneShot<{
    title?: unknown;
    prompt?: unknown;
    cron?: unknown;
  }>({
    system: SYSTEM_INSTRUCTION,
    request,
    directory: directory ?? null,
  });
  if (!result.ok) return result;

  const parsed = result.value;
  return {
    ok: true,
    title: typeof parsed.title === "string" ? parsed.title.slice(0, 50) : "",
    prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
    cron: typeof parsed.cron === "string" ? parsed.cron.trim() : "",
  };
}
