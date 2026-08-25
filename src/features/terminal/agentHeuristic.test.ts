import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";

import {
  classifyCliQuiet,
  classifyShellQuiet,
  createAgentHeuristic,
  pendingAgentHeuristicDeadlines,
} from "./agentHeuristic";
import {
  DEFAULT_CLI_PROFILE,
  DEFAULT_SHELL_PROFILE,
  resolveAttentionProfile,
} from "./attentionProfile";

describe("resolveAttentionProfile", () => {
  it("uses the shell profile when there is no cli id", () => {
    expect(resolveAttentionProfile()).toBe(DEFAULT_SHELL_PROFILE);
  });

  it("uses the CLI default for any agent id", () => {
    expect(resolveAttentionProfile("brand-new-agent")).toBe(DEFAULT_CLI_PROFILE);
    expect(resolveAttentionProfile("opencode")).toBe(DEFAULT_CLI_PROFILE);
    expect(resolveAttentionProfile("claude-code")).toBe(DEFAULT_CLI_PROFILE);
  });
});

describe("classifyCliQuiet", () => {
  it("promotes working silence to needs-attention", () => {
    expect(
      classifyCliQuiet({
        current: "working",
        vicinity: "❯ ",
        profile: DEFAULT_CLI_PROFILE,
      }),
    ).toEqual({ action: "needs-attention" });
  });

  it("holds working when the vicinity still looks busy", () => {
    expect(
      classifyCliQuiet({
        current: "working",
        vicinity: "Thinking…",
        profile: DEFAULT_CLI_PROFILE,
      }),
    ).toEqual({ action: "working" });
  });

  it("forces attention on a confirm prompt even from idle", () => {
    const decision = classifyCliQuiet({
      current: "idle",
      vicinity: "Allow this command? (y/n)",
      profile: DEFAULT_CLI_PROFILE,
    });
    expect(decision.action).toBe("needs-attention");
  });

  it("does not idle a CLI tab that is already waiting", () => {
    expect(
      classifyCliQuiet({
        current: "needs-attention",
        vicinity: "❯ ",
        profile: DEFAULT_CLI_PROFILE,
      }),
    ).toEqual({ action: "keep" });
  });

  it("does not override a done signal", () => {
    expect(
      classifyCliQuiet({
        current: "done",
        vicinity: "Thinking",
        profile: DEFAULT_CLI_PROFILE,
      }),
    ).toEqual({ action: "keep" });
  });
});

describe("classifyShellQuiet", () => {
  it("returns to idle after working silence without a confirm", () => {
    expect(
      classifyShellQuiet({
        current: "working",
        vicinity: "user@host ~ %",
        profile: DEFAULT_SHELL_PROFILE,
        attentionFromHeuristic: false,
      }),
    ).toEqual({ action: "idle" });
  });

  it("flags a confirm prompt", () => {
    const decision = classifyShellQuiet({
      current: "working",
      vicinity: "Continue? (y/n)",
      profile: DEFAULT_SHELL_PROFILE,
      attentionFromHeuristic: false,
    });
    expect(decision.action).toBe("needs-attention");
  });
});

describe("shared quiet deadline scheduler", () => {
  it("tracks many tabs through one shared scheduler", () => {
    const writeListeners: Array<() => void> = [];
    const disposables = Array.from({ length: 12 }, () =>
      createAgentHeuristic(
        {
          onWriteParsed: (listener: () => void) => {
            writeListeners.push(listener);
            return { dispose: vi.fn() };
          },
          onData: () => ({ dispose: vi.fn() }),
        } as unknown as Terminal,
        {
          cliId: "codex",
          getStatus: () => "working",
          setStatus: vi.fn(),
        },
      ),
    );

    writeListeners.forEach((listener) => listener());
    expect(pendingAgentHeuristicDeadlines()).toBe(12);

    disposables.forEach((disposable) => disposable.dispose());
    expect(pendingAgentHeuristicDeadlines()).toBe(0);
  });
});
