import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_CLI_REGISTRY, enabledCliTools } from "./cli-registry";

describe("canonical CLI capabilities", () => {
  it("every launcher surface derives the same availability", () => {
    const disabledId = DEFAULT_CLI_REGISTRY[0].id;
    expect(enabledCliTools({ [disabledId]: false }).some((cli) => cli.id === disabledId)).toBe(false);

    for (const path of [
      "src/app/ProjectEmptyState.tsx",
      "src/components/file-explorer/TreeNode.tsx",
      "src/components/source-control/WorktreesSection.tsx",
      "src/components/v3-shell/NewAgentModal.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("DEFAULT_CLI_REGISTRY");
      expect(source, path).toContain("useEnabledCliTools");
    }
  });
});
