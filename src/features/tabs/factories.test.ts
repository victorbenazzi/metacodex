import { describe, expect, it } from "vitest";

import type { CliTool } from "@/features/terminal/cli-registry";
import {
  isProcessTab,
  isWorkbenchDocTab,
  makeCliTab,
  makeDiffTab,
  makeFileTab,
  makePreviewTab,
  makeTerminalTab,
} from "./factories";

const cli: CliTool = {
  id: "claude",
  label: "Claude Code",
  command: "claude",
  args: [],
  elevatedArgs: ["--dangerously-skip-permissions"],
  detectCommand: "command -v claude",
  installCommand: "npm i -g @anthropic-ai/claude-code",
  description: "test",
};

describe("makeFileTab", () => {
  it("opens markdown in preview unless asked to edit", () => {
    const preview = makeFileTab({
      projectId: "p1",
      path: "/repo/README.md",
      name: "README.md",
    });
    expect(preview.kind).toBe("markdown");
    if (preview.kind === "markdown") expect(preview.mode).toBe("preview");

    const source = makeFileTab({
      projectId: "p1",
      path: "/repo/README.md",
      name: "README.md",
      openInEditMode: true,
    });
    if (source.kind === "markdown") expect(source.mode).toBe("source");
  });

  it("picks image, pdf and editor from the extension", () => {
    expect(makeFileTab({ projectId: "p1", path: "/a.png", name: "a.png" }).kind).toBe("image");
    expect(makeFileTab({ projectId: "p1", path: "/a.pdf", name: "a.pdf" }).kind).toBe("pdf");
    expect(makeFileTab({ projectId: "p1", path: "/a.ts", name: "a.ts" }).kind).toBe("editor");
  });
});

describe("makePreviewTab", () => {
  it("is a grant-backed tab outside any project", () => {
    const tab = makePreviewTab({ path: "/tmp/note.md", grantId: "g1" });
    expect(tab.projectId).toBeNull();
    expect(tab.id).toBe("pf-/tmp/note.md");
    expect(tab.previewGrantId).toBe("g1");
    expect(tab.kind).toBe("markdown");
  });
});

describe("process vs document helpers", () => {
  it("classifies terminal and cli as process tabs", () => {
    const term = makeTerminalTab({
      projectId: "p1",
      cwd: "/repo",
      title: "zsh",
    });
    const agent = makeCliTab({
      projectId: "p1",
      cwd: "/repo",
      cli,
    });
    expect(term.id.startsWith("t-")).toBe(true);
    expect(agent.cliId).toBe("claude");
    expect(agent.launchCommand).toContain("claude");
    expect(isProcessTab(term)).toBe(true);
    expect(isProcessTab(agent)).toBe(true);
    expect(isWorkbenchDocTab(term)).toBe(false);
  });

  it("adds elevated flags only to the explicitly elevated tab", () => {
    const normal = makeCliTab({ projectId: "p1", cwd: "/repo", cli });
    const elevated = makeCliTab({ projectId: "p1", cwd: "/repo", cli, elevated: true });

    expect(normal.launchArgs).toEqual([]);
    expect(normal.launchCommand).not.toContain("dangerously-skip-permissions");
    expect(elevated.launchArgs).toEqual(["--dangerously-skip-permissions"]);
    expect(elevated.launchCommand).toContain("--dangerously-skip-permissions");
  });

  it("classifies file and diff tabs as workbench docs", () => {
    const file = makeFileTab({ projectId: "p1", path: "/a.ts", name: "a.ts" });
    const diff = makeDiffTab({ projectId: "p1", path: "/a.ts", status: "M" });
    expect(diff.id).toBe("diff-/a.ts");
    expect(isWorkbenchDocTab(file)).toBe(true);
    expect(isWorkbenchDocTab(diff)).toBe(true);
    expect(isProcessTab(file)).toBe(false);
  });
});
