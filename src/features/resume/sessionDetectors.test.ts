import { describe, expect, it } from "vitest";

import { detectorFor, resumeArgsFor, supportsResume } from "./sessionDetectors";

describe("resume invocation", () => {
  it("treats Codex resume as a subcommand", () => {
    expect(resumeArgsFor("codex-cli", "sess-1")).toEqual(["resume", "sess-1"]);
    expect(supportsResume("codex-cli")).toBe(true);
  });

  it("keeps Claude on --resume and OpenCode on --session", () => {
    expect(resumeArgsFor("claude-code", "sess-1")).toEqual(["--resume", "sess-1"]);
    expect(resumeArgsFor("opencode", "ses_abc")).toEqual(["--session", "ses_abc"]);
  });

  it("hides resume for tools without a known invocation", () => {
    expect(resumeArgsFor("aider", "sess-1")).toBeNull();
    expect(supportsResume("aider")).toBe(false);
  });
});

describe("codex session detector", () => {
  const detect = detectorFor("codex-cli")!;

  it("prefers a UUID on a Session line", () => {
    const tail = [
      "OpenAI Codex (v0.148.0)",
      "Session: 019dd4bf-0929-7ea0-b227-1f51085e7d71",
      "directory: ~/Projetos/sistema-petshop",
    ].join("\n");
    expect(detect(tail)).toEqual({ sessionId: "019dd4bf-0929-7ea0-b227-1f51085e7d71" });
  });

  it("accepts a hex Session-Token", () => {
    expect(detect("Session-Token: deadbeefcafebabe01234567")).toEqual({
      sessionId: "deadbeefcafebabe01234567",
    });
  });

  it("does not treat a path or thread title as a session id", () => {
    const tail = [
      "session started in ~/Projetos/sistema-petshop-workspace",
      "directory: ~/Projetos/sistema-petshop",
    ].join("\n");
    expect(detect(tail)).toBeNull();
  });
});
