import { describe, expect, it } from "vitest";

import {
  cliLaunchString,
  DEFAULT_CLI_REGISTRY,
  enabledAgentsByCategory,
  enabledCliTools,
  normalizeCliTool,
} from "./cli-registry";

describe("CLI launch policy", () => {
  it("default launch strings contain no bypass flags", () => {
    for (const id of ["claude-code", "grok", "kimi-code"]) {
      const cli = DEFAULT_CLI_REGISTRY.find((entry) => entry.id === id)!;
      expect(cliLaunchString(cli)).not.toMatch(
        /dangerously-skip-permissions|always-approve|--yolo/,
      );
      expect(cliLaunchString(cli, { elevated: true })).toContain(cli.elevatedArgs![0]);
    }
  });

  it("moves legacy bypass flags into elevated arguments", () => {
    const cli = normalizeCliTool({
      ...DEFAULT_CLI_REGISTRY[0],
      args: ["--verbose", "--dangerously-skip-permissions"],
      elevatedArgs: [],
    });
    expect(cli.args).toEqual(["--verbose"]);
    expect(cli.elevatedArgs).toEqual(["--dangerously-skip-permissions"]);
  });

  it("uses one enabled-agent registry for flat and categorized launchers", () => {
    const disabledId = DEFAULT_CLI_REGISTRY[0].id;
    const enabled = { [disabledId]: false };
    const flat = enabledCliTools(enabled);
    const categorized = enabledAgentsByCategory(enabled);

    expect(flat.some((cli) => cli.id === disabledId)).toBe(false);
    expect([...categorized.coding, ...categorized.autonomous]).toEqual(flat);
  });
});
