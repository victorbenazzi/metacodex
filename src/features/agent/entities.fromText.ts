import { firstGrapheme } from "@/lib/grapheme";

import { extractJsonOneShot } from "./oc";

/**
 * Natural-language → agent-entity draft. Same dance as `cron.fromText`: a
 * throwaway one-shot turn (via `oc.extractJsonOneShot`) asks the model for a
 * strict JSON descriptor, which prefills the Agent builder for the user to
 * review and save (never auto-saved). No tools, pure text in, JSON out.
 */

export type AgentDraftResult =
  | { ok: true; name: string; persona: string; emoji: string }
  | { ok: false; error: string };

const SYSTEM_INSTRUCTION = [
  "You turn a user's description into a reusable AI agent definition.",
  "Respond with ONLY a single minified JSON object, no prose and no markdown fence:",
  '{"name": string, "persona": string, "emoji": string}',
  '- "name": a short display name for the agent, max 40 chars, in the user\'s language.',
  '- "persona": the agent\'s system prompt: identity, expertise, working style, rules.',
  "  Write it in second person (\"You are...\"), 4-12 sentences, in the user's language.",
  '- "emoji": ONE emoji that fits the agent.',
].join("\n");

export async function extractAgentDraft(
  request: string,
  directory?: string | null,
): Promise<AgentDraftResult> {
  const result = await extractJsonOneShot<{
    name?: unknown;
    persona?: unknown;
    emoji?: unknown;
  }>({
    system: SYSTEM_INSTRUCTION,
    request,
    directory: directory ?? null,
  });
  if (!result.ok) return result;

  const parsed = result.value;
  const name = typeof parsed.name === "string" ? parsed.name.slice(0, 40) : "";
  const persona = typeof parsed.persona === "string" ? parsed.persona : "";
  // A draft without a name AND without a persona prefills nothing; surface it
  // as a miss so the dialog shows its "try rephrasing" hint.
  if (!name.trim() && !persona.trim()) {
    return { ok: false, error: "no draft could be read from the reply" };
  }
  return {
    ok: true,
    name,
    persona,
    emoji: typeof parsed.emoji === "string" ? firstGrapheme(parsed.emoji) : "",
  };
}
