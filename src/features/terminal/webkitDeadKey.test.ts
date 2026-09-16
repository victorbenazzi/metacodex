// @vitest-environment jsdom

import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";

import { isWebKitEngine, WebKitDeadKeyAddon } from "./webkitDeadKey";

function keyboardEvent(
  type: "keydown" | "keypress" | "keyup",
  init: KeyboardEventInit & { charCode?: number },
): KeyboardEvent {
  const event = new KeyboardEvent(type, init);
  if (init.charCode !== undefined) {
    Object.defineProperty(event, "charCode", { value: init.charCode });
  }
  return event;
}

function harness(enabled = true, screenReaderMode = false) {
  const textarea = document.createElement("textarea");
  const input = vi.fn();
  const terminal = {
    textarea,
    input,
    options: { screenReaderMode },
  } as unknown as Terminal;
  const addon = new WebKitDeadKeyAddon(enabled);
  addon.activate(terminal);
  return { addon, input, textarea };
}

function startDeadKeyComposition(addon: WebKitDeadKeyAddon, textarea: HTMLTextAreaElement) {
  textarea.dispatchEvent(new CompositionEvent("compositionstart"));
  addon.intercept(keyboardEvent("keydown", { key: "Dead" }));
}

function endComposition(textarea: HTMLTextAreaElement, data: string) {
  textarea.dispatchEvent(new CompositionEvent("compositionend", { data }));
}

describe("WebKitDeadKeyAddon", () => {
  it("suppresses a synthetic keypress that repeats an accented commit", () => {
    const { addon, input, textarea } = harness();
    startDeadKeyComposition(addon, textarea);
    endComposition(textarea, "é");

    expect(addon.intercept(keyboardEvent("keypress", { key: "é", charCode: 233 }))).toBe(true);
    expect(input).not.toHaveBeenCalled();
  });

  it("suppresses a synthetic keydown that repeats an accented commit", () => {
    const { addon, textarea } = harness();
    startDeadKeyComposition(addon, textarea);
    endComposition(textarea, "á");

    expect(addon.intercept(keyboardEvent("keydown", { key: "á" }))).toBe(true);
  });

  it("restores the physical key from WebKit's concatenated cancellation key", () => {
    const { addon, input, textarea } = harness();
    startDeadKeyComposition(addon, textarea);
    endComposition(textarea, "~");

    expect(addon.intercept(keyboardEvent("keydown", { key: "~/" }))).toBe(true);
    expect(input).toHaveBeenCalledOnce();
    expect(input).toHaveBeenCalledWith("/", true);
    expect(addon.intercept(keyboardEvent("keypress", { key: "~/", charCode: 126 }))).toBe(true);
  });

  it("recognizes WebKitGTK ordering where Dead precedes compositionstart", () => {
    const { addon, textarea } = harness();
    addon.intercept(keyboardEvent("keydown", { key: "Dead" }));
    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    endComposition(textarea, "ê");

    expect(addon.intercept(keyboardEvent("keypress", { key: "ê", charCode: 234 }))).toBe(true);
  });

  it("removes retained textarea input before a dead-key fallback snapshots it", () => {
    const { addon, textarea } = harness();
    textarea.value = "ááá";

    addon.intercept(keyboardEvent("keydown", { key: "Dead", keyCode: 229 }));

    expect(textarea.value).toBe("");
  });

  it("removes retained textarea input before xterm records a composition offset", () => {
    const { textarea } = harness();
    textarea.value = "earlier input";

    textarea.dispatchEvent(new CompositionEvent("compositionstart"));

    expect(textarea.value).toBe("");
  });

  it("preserves the textarea buffer in screen reader mode", () => {
    const { addon, textarea } = harness(true, true);
    textarea.value = "accessible context";

    addon.intercept(keyboardEvent("keydown", { key: "Dead", keyCode: 229 }));
    textarea.dispatchEvent(new CompositionEvent("compositionstart"));

    expect(textarea.value).toBe("accessible context");
  });

  it("does not intercept ordinary IME commits or directly typed accents", () => {
    const { addon, textarea } = harness();
    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    endComposition(textarea, "é");

    expect(addon.intercept(keyboardEvent("keydown", { key: "é" }))).toBe(false);
    expect(addon.intercept(keyboardEvent("keypress", { key: "é", charCode: 233 }))).toBe(false);
  });

  it("clears a commit at the physical key boundary", () => {
    const { addon, textarea } = harness();
    startDeadKeyComposition(addon, textarea);
    endComposition(textarea, "é");
    addon.intercept(keyboardEvent("keyup", { key: "e" }));

    expect(addon.intercept(keyboardEvent("keypress", { key: "é", charCode: 233 }))).toBe(false);
  });

  it("is inert outside WebKit", () => {
    const { addon, textarea } = harness(false);
    startDeadKeyComposition(addon, textarea);
    endComposition(textarea, "é");

    expect(addon.intercept(keyboardEvent("keypress", { key: "é", charCode: 233 }))).toBe(false);
  });
});

describe("isWebKitEngine", () => {
  it("accepts WKWebView and WebKitGTK user agents", () => {
    expect(isWebKitEngine("Mozilla/5.0 AppleWebKit/605.1.15 Safari/605.1.15")).toBe(true);
    expect(isWebKitEngine("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15")).toBe(true);
  });

  it("rejects Chromium-based WebView2 and regular Chrome", () => {
    expect(isWebKitEngine("AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0")).toBe(false);
    expect(isWebKitEngine("AppleWebKit/537.36 Chromium/140.0.0.0 Safari/537.36")).toBe(false);
  });
});
