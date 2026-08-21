import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../../src-tauri/src/commands/browser_init.js", import.meta.url),
  "utf8",
);

interface GuestHarness {
  window: Record<string, unknown> & {
    __mcx: {
      setMode: (token: string, mode: string) => boolean;
      prepareCapture: (token: string, mode: string, barrierId: string) => boolean;
      clearDraw: (token: string) => boolean;
    };
  };
  opened: string[];
  dispatch: (name: string, event: Record<string, unknown>) => void;
  history: { pushState: (...args: unknown[]) => unknown };
  setHostMode: (mode: string) => boolean;
  prepareCapture: (mode: string, barrierId: string) => boolean;
  flushFrame: () => void;
  replaceEncoder: (encoder: (value: string) => string) => void;
  setLocation: (href: string, title: string) => void;
}

function createGuest(options: {
  requestAnimationFrame?: false;
  deferAnimationFrames?: boolean;
} = {}): GuestHarness {
  const opened: string[] = [];
  const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const nodes = new Map<string, Record<string, unknown>>();
  const register = (name: string, handler: (event: Record<string, unknown>) => void) => {
    const current = listeners.get(name) ?? [];
    current.push(handler);
    listeners.set(name, current);
  };
  const context = {
    setTransform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
  };
  const makeNode = (tagName: string) => {
    const node: Record<string, unknown> = {
      id: "",
      tagName: tagName.toUpperCase(),
      nodeType: 1,
      style: {},
      classList: [],
      children: [],
      parentElement: null,
      textContent: "",
      appendChild(child: Record<string, unknown>) {
        (node.children as Record<string, unknown>[]).push(child);
        child.parentElement = node;
        if (typeof child.id === "string" && child.id) nodes.set(child.id, child);
        return child;
      },
      getAttribute() { return null; },
      getBoundingClientRect() {
        return { x: 10, y: 20, left: 10, top: 20, right: 330, bottom: 68, width: 320, height: 48 };
      },
      getRootNode() { return null; },
      closest() { return null; },
      contains() { return true; },
      getContext() { return context; },
    };
    return node;
  };
  const body = makeNode("body");
  const documentElement = makeNode("html");
  const target = makeNode("h1");
  target.id = "hero-title";
  target.classList = ["display", "hero"];
  target.innerText = "Build faster";
  target.parentElement = body;
  target.getAttribute = (name: string) => name === "role" ? "heading" : null;

  const document = {
    body,
    documentElement,
    title: "Pricing",
    readyState: "loading",
    createElement: makeNode,
    getElementById(id: string) { return nodes.get(id) ?? null; },
    elementFromPoint() { return target; },
    addEventListener: register,
  };
  const history = {
    pushState() { return undefined; },
    replaceState() { return undefined; },
  };
  const location = { href: "https://example.com/pricing" };
  const animationFrames: Array<() => void> = [];
  const requestAnimationFrame = (callback: () => void) => {
    if (options.deferAnimationFrames) animationFrames.push(callback);
    else callback();
    return 1;
  };
  const windowObject: Record<string, unknown> = {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
    open(url: string) { opened.push(url); return null; },
    addEventListener: register,
    ...(options.requestAnimationFrame === false ? {} : { requestAnimationFrame }),
    getComputedStyle() {
      return { getPropertyValue: (name: string) => name === "font-size" ? "48px" : "" };
    },
    getSelection() { return { toString: () => "", anchorNode: null }; },
  };
  const sandbox: Record<string, unknown> = {
    window: windowObject,
    document,
    history,
    location,
    CSS: { escape: (value: string) => value },
    requestAnimationFrame,
    setTimeout,
    clearTimeout,
  };
  Object.assign(windowObject, {
    window: windowObject,
    document,
    history,
    location,
    CSS: sandbox.CSS,
    setTimeout,
    clearTimeout,
  });
  vm.runInNewContext(source.replaceAll("__MCX_BRIDGE_TOKEN__", "test-token"), sandbox);

  return {
    window: windowObject as GuestHarness["window"],
    opened,
    dispatch(name, event) {
      for (const handler of listeners.get(name) ?? []) handler(event);
    },
    history,
    setHostMode(mode) {
      return (windowObject as GuestHarness["window"]).__mcx.setMode("test-token", mode);
    },
    prepareCapture(mode, barrierId) {
      return (windowObject as GuestHarness["window"]).__mcx.prepareCapture(
        "test-token",
        mode,
        barrierId,
      );
    },
    flushFrame() {
      const pending = animationFrames.splice(0);
      for (const callback of pending) callback();
    },
    replaceEncoder(encoder) {
      sandbox.encodeURIComponent = encoder;
    },
    setLocation(href, title) {
      location.href = href;
      document.title = title;
    },
  };
}

function trustedEvent(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isTrusted: true,
    clientX: 20,
    clientY: 30,
    preventDefault() {},
    stopPropagation() {},
    ...extra,
  };
}

describe("browser guest bridge", () => {
  it("sends the selected target in the authenticated gesture message", () => {
    const guest = createGuest();
    guest.setHostMode("pick");
    guest.dispatch("mousemove", trustedEvent());
    guest.dispatch("click", trustedEvent());

    const message = new URL(guest.opened.at(-1) ?? "");
    expect(message.pathname).toBe("/selection");
    expect(message.searchParams.get("token")).toBe("test-token");
    expect(message.searchParams.get("kind")).toBe("text");
    expect(message.searchParams.get("selector")).toBe("#hero-title");
    expect(message.searchParams.get("text")).toBe("Build faster");
    expect(message.searchParams.get("width")).toBe("320");
    expect(message.searchParams.get("viewportWidth")).toBe("1440");
  });

  it("keeps capture mode until the host sends a new mode", () => {
    const guest = createGuest();
    guest.setHostMode("capture");
    guest.dispatch("pointerdown", trustedEvent({ clientX: 10, clientY: 20 }));
    guest.dispatch("pointerup", trustedEvent({ clientX: 110, clientY: 100 }));
    guest.dispatch("pointerdown", trustedEvent({ clientX: 20, clientY: 30 }));
    guest.dispatch("pointerup", trustedEvent({ clientX: 120, clientY: 110 }));

    const captures = guest.opened.map((value) => new URL(value)).filter((url) => url.pathname === "/capture");
    expect(captures).toHaveLength(2);
    expect(captures[0]?.searchParams.get("width")).toBe("100");
    expect(captures[0]?.searchParams.get("height")).toBe("80");
  });

  it("ignores untrusted gestures and exposes only host controls", () => {
    const guest = createGuest();
    guest.setHostMode("pick");
    guest.dispatch("mousemove", trustedEvent());
    guest.dispatch("click", trustedEvent({ isTrusted: false }));

    expect(guest.opened.filter((value) => new URL(value).pathname === "/selection"))
      .toHaveLength(0);
    expect(Object.keys(guest.window.__mcx).sort()).toEqual([
      "clearDraw",
      "prepareCapture",
      "setMode",
    ]);
  });

  it("rejects page calls to host controls and keeps the control object immutable", () => {
    const guest = createGuest();
    guest.window.__mcx.setMode("pick", "pick");
    guest.dispatch("mousemove", trustedEvent());
    guest.dispatch("click", trustedEvent());

    expect(guest.opened).toHaveLength(0);
    expect(Object.isFrozen(guest.window.__mcx)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(guest.window, "__mcx")).toMatchObject({
      configurable: false,
      writable: false,
    });
  });

  it("publishes location changes without polling", () => {
    const guest = createGuest();
    guest.history.pushState({}, "", "/pricing");

    const message = new URL(guest.opened.at(-1) ?? "");
    expect(message.pathname).toBe("/location");
    expect(message.searchParams.get("url")).toBe("https://example.com/pricing");
    expect(message.searchParams.get("title")).toBe("Pricing");
  });

  it("caps location fields by UTF-8 bytes without splitting Unicode", () => {
    const guest = createGuest();
    guest.setLocation(
      `https://example.com/${"é".repeat(5000)}`,
      "🚀".repeat(400),
    );
    guest.history.pushState({}, "", "/unicode");

    const message = new URL(guest.opened.at(-1) ?? "");
    const href = message.searchParams.get("url") ?? "";
    const title = message.searchParams.get("title") ?? "";
    expect(Buffer.byteLength(href, "utf8")).toBeLessThanOrEqual(8192);
    expect(Buffer.byteLength(title, "utf8")).toBeLessThanOrEqual(1024);
    expect(href.endsWith("é")).toBe(true);
    expect(title.endsWith("🚀")).toBe(true);
  });

  it("does not expose the token or forward arbitrary page keys", () => {
    const guest = createGuest();
    guest.dispatch("keydown", trustedEvent({ key: "k", code: "KeyK", metaKey: true }));

    expect(guest.opened).toHaveLength(0);
    expect(guest.window).not.toHaveProperty("bridgeToken");
    expect(guest.window.__mcx).not.toHaveProperty("bridgeToken");
  });

  it("reports a host mode ready only after the guest compositor frames", () => {
    const guest = createGuest({ deferAnimationFrames: true });
    expect(guest.setHostMode("pick")).toBe(false);
    expect(guest.setHostMode("pick")).toBe(false);
    guest.flushFrame();
    expect(guest.setHostMode("pick")).toBe(false);
    guest.flushFrame();
    expect(guest.setHostMode("pick")).toBe(true);

    expect(guest.opened.some((value) => new URL(value).pathname === "/mode-ready"))
      .toBe(false);
  });

  it("creates a fresh two-frame capture barrier without leaving draw mode", () => {
    const guest = createGuest({ deferAnimationFrames: true });
    guest.setHostMode("draw");
    guest.flushFrame();
    guest.flushFrame();
    expect(guest.setHostMode("draw")).toBe(true);

    expect(guest.prepareCapture("draw", "capture-1")).toBe(false);
    guest.flushFrame();
    expect(guest.prepareCapture("draw", "capture-1")).toBe(false);
    guest.flushFrame();
    expect(guest.prepareCapture("draw", "capture-1")).toBe(true);
    expect(guest.setHostMode("draw")).toBe(true);

    expect(guest.prepareCapture("draw", "capture-2")).toBe(false);
  });

  it("installs before requestAnimationFrame is available", () => {
    expect(() => createGuest({ requestAnimationFrame: false })).not.toThrow();
  });

  it("does not expose the bridge token through a page-patched encoder", () => {
    const guest = createGuest();
    const observed: string[] = [];
    guest.replaceEncoder((value) => {
      observed.push(value);
      return encodeURIComponent(value);
    });
    guest.setHostMode("pick");
    guest.dispatch("mousemove", trustedEvent());
    guest.dispatch("click", trustedEvent());

    expect(observed).not.toContain("test-token");
    expect(new URL(guest.opened.at(-1) ?? "").searchParams.get("token"))
      .toBe("test-token");
  });
});
