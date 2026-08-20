import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { COMMANDS } from "./commands";

const dispatcher = readFileSync(
  new URL("../../app/KeyboardShortcuts.tsx", import.meta.url),
  "utf8",
);

describe("keybinding command contract", () => {
  it("every registered command has a functional dispatcher", () => {
    for (const command of COMMANDS) {
      expect(dispatcher).toContain(`case "${command.id}"`);
    }
    expect(COMMANDS.some((command) => command.id === ("tab.rename" as never))).toBe(false);
  });
});
