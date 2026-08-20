import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const qualityUrl = new URL(".github/workflows/quality.yml", root);
const qualityExists = existsSync(qualityUrl);

describe("quality and release workflows", () => {
  it.skipIf(!qualityExists)("runs mandatory gates on push and pull request", () => {
    const workflow = readFileSync(qualityUrl, "utf8");
    for (const required of [
      "push:",
      "pull_request:",
      "workflow_call:",
      "pnpm install --frozen-lockfile",
      "pnpm audit --prod --audit-level high",
      "pnpm test",
      "pnpm build",
      "check:traceability",
      "cargo fmt --all -- --check",
      "cargo clippy --all-targets -- -D warnings",
      "cargo check --all-targets",
      "cargo test",
    ]) {
      expect(workflow).toContain(required);
    }
  });

  it.skipIf(!qualityExists)("covers macOS Windows and Linux", () => {
    const workflow = readFileSync(qualityUrl, "utf8");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toMatch(/ubuntu-(?:latest|22\.04)/);
  });

  it.skipIf(!qualityExists)("makes release publication depend on quality", () => {
    const release = readFileSync(new URL(".github/workflows/release.yml", root), "utf8");
    expect(release).toContain("uses: ./.github/workflows/quality.yml");
    expect(release).toMatch(/publish-tauri:\s*[\s\S]*?needs:\s*quality/);
  });
});
