import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

function extractQuotedValues(source: string, blockPattern: RegExp): string[] {
  const block = source.match(blockPattern)?.[1];
  if (!block) throw new Error(`Could not find block matching ${blockPattern}`);
  return [...block.matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function extractRustCommands(source: string): string[] {
  const block = source.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];
  if (!block) throw new Error("Could not find Tauri generate_handler block");
  return [...block.matchAll(/commands(?:::[a-z_]+)+::([a-z_]+)\s*,/g)].map(
    (match) => match[1],
  );
}

function extractRustEvents(source: string): string[] {
  return [...source.matchAll(/pub const EV_[A-Z_]+:\s*&str\s*=\s*"([^"]+)"/g)].map(
    (match) => match[1],
  );
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

describe("Tauri IPC parity", () => {
  it("keeps all Rust and TypeScript commands equal", () => {
    const typescript = readFileSync(new URL("src/lib/ipc.ts", root), "utf8");
    const rust = readFileSync(new URL("src-tauri/src/lib.rs", root), "utf8");
    const tsCommands = sortedUnique(
      extractQuotedValues(typescript, /export const CMD = \{([\s\S]*?)\}\s+as const/),
    );
    const rustCommands = sortedUnique(extractRustCommands(rust));

    expect(tsCommands).toHaveLength(82);
    expect(rustCommands).toHaveLength(82);
    expect(tsCommands).toEqual(rustCommands);
  });

  it("keeps all Rust and TypeScript events equal", () => {
    const typescript = readFileSync(new URL("src/lib/events.ts", root), "utf8");
    const rustEvents = readFileSync(new URL("src-tauri/src/events.rs", root), "utf8");
    const rustWatcher = readFileSync(new URL("src-tauri/src/watcher.rs", root), "utf8");
    const tsEvents = sortedUnique(
      extractQuotedValues(typescript, /export const EV = \{([\s\S]*?)\}\s+as const/),
    );
    const rust = sortedUnique([
      ...extractRustEvents(rustEvents),
      ...extractRustEvents(rustWatcher),
    ]);

    expect(tsEvents).toHaveLength(12);
    expect(rust).toHaveLength(12);
    expect(tsEvents).toEqual(rust);
  });
});
