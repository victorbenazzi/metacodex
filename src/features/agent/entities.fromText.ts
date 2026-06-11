import { CMD, invoke } from "@/lib/ipc";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";

import { DEFAULT_MODEL } from "./chat.store";
import { errMessage, oneShotPrompt } from "./oc";
import type { RuntimeStatus } from "./runtime.store";

/**
 * Natural-language → agent-entity draft. Same dance as `cron.fromText`: a
 * throwaway one-shot turn asks the model for a strict JSON descriptor, which
 * prefills the Agent builder for the user to review and save (never
 * auto-saved). No tools, pure text in, JSON out.
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

function parseDraftJson(
  text: string,
): { name?: unknown; persona?: unknown; emoji?: unknown } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function extractAgentDraft(
  request: string,
  directory?: string | null,
): Promise<AgentDraftResult> {
  const text = request.trim();
  if (!text) return { ok: false, error: "empty request" };

  const agent = useSettingsDataStore.getState().settings.agent;
  const model = {
    providerID: agent.providerId || "opencode-go",
    modelID: agent.modelId || DEFAULT_MODEL,
  };

  try {
    const status = await invoke<RuntimeStatus>(CMD.agentRuntimeStart);
    const base = status.baseUrl;
    if (!base) return { ok: false, error: "runtime not connected" };

    const replyText = await oneShotPrompt(base, directory ?? null, {
      parts: [{ type: "text", text }],
      system: SYSTEM_INSTRUCTION,
      model,
    });
    if (!replyText) return { ok: false, error: "model call failed" };

    const parsed = parseDraftJson(replyText);
    if (!parsed) return { ok: false, error: "no draft could be read from the reply" };

    return {
      ok: true,
      name: typeof parsed.name === "string" ? parsed.name.slice(0, 40) : "",
      persona: typeof parsed.persona === "string" ? parsed.persona : "",
      emoji: typeof parsed.emoji === "string" ? parsed.emoji.trim().slice(0, 4) : "",
    };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}
