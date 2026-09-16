export type UsageProviderId = "codex-cli" | "claude-code" | "cursor-cli" | "grok";
export type UsageStatus = "ready" | "partial" | "waiting" | "disabled" | "unsupported" | "notInstalled" | "signedOut" | "error";

export interface QuotaWindow {
  id: string;
  label: string | null;
  usedPercent: number;
  durationMinutes: number | null;
  resetsAt: number | null;
}
export interface DailyUsage { date: string; tokens: string }
export interface SessionUsage {
  sessionId: string;
  projectId: string | null;
  model: string | null;
  estimatedCostUsd: number | null;
  contextUsedPercent: number | null;
  observedAt: number;
}
export interface AccountDay { date: string; requests: number; tokens: string | null; apiCostUsd: number | null; chargedUsd: number | null }
export interface AccountUsage {
  source: "localFile" | "sessionCookie";
  includedUsedUsd: number | null;
  includedLimitUsd: number | null;
  onDemandUsedUsd: number | null;
  onDemandLimitUsd: number | null;
  history: AccountDay[];
  historyStart: number | null;
  historyEnd: number | null;
  historyIssue: string | null;
}
export interface ProviderUsage {
  id: UsageProviderId;
  status: UsageStatus;
  accountLabel: string | null;
  plan: string | null;
  observedAt: number | null;
  windows: QuotaWindow[];
  dailyUsage: DailyUsage[];
  sessions: SessionUsage[];
  turns: UsageTurn[];
  billing: BillingUsage | null;
  account?: AccountUsage | null;
  issue: string | null;
}
export interface UsageTurn {
  sessionId: string;
  generationId: string;
  projectId: string | null;
  model: string | null;
  inputTokens: string | null;
  outputTokens: string | null;
  cacheReadTokens: string | null;
  cacheWriteTokens: string | null;
  observedAt: number;
}
export interface BillingUsage {
  periodStart: number | null;
  periodEnd: number | null;
  usagePeriodStart: number | null;
  usagePeriodEnd: number | null;
}
export interface UsageSnapshot { providers: ProviderUsage[]; claudeEnabled: boolean; cursorEnabled: boolean }

export const USAGE_PROVIDERS = [
  { id: "codex-cli", name: "Codex", docs: "https://developers.openai.com/codex/app-server/" },
  { id: "claude-code", name: "Claude Code", docs: "https://code.claude.com/docs/en/statusline" },
  { id: "cursor-cli", name: "Cursor", docs: "https://cursor.com/docs/hooks" },
  { id: "grok", name: "Grok Build", docs: "https://docs.x.ai/build/overview" },
] as const;

export function initialSnapshot(): UsageSnapshot {
  return { claudeEnabled: false, cursorEnabled: false, providers: USAGE_PROVIDERS.map(({ id }) => ({
    id, status: id === "codex-cli" || id === "grok" ? "waiting" : "disabled",
    accountLabel: null, plan: null, observedAt: null, windows: [], dailyUsage: [], sessions: [], turns: [], billing: null, issue: null,
  })) };
}
