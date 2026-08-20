// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  events: [] as string[],
  frames: [] as FrameRequestCallback[],
  fits: [] as Array<{ fit: ReturnType<typeof vi.fn> }>,
  terminals: [] as Array<{
    options: Record<string, unknown>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  width: 800,
}));

const settingsState = vi.hoisted(() => ({
  settings: {
    terminal: {
      fontFamily: "Test Mono",
      fontSize: 13,
      cursorStyle: "bar" as const,
      scrollback: 5_000,
    },
    accessibility: {
      screenReaderMode: false,
    },
  },
}));

const themeState = vi.hoisted(() => ({
  theme: { id: "porcelain" },
  effective: "light" as "light" | "dark",
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class FakeTerminal {
    options: Record<string, unknown>;
    dispose = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      runtime.terminals.push(this);
    }

    loadAddon(addon: { kind?: string }) {
      runtime.events.push(`load:${addon.kind ?? "unknown"}`);
    }

    open() {
      runtime.events.push("open");
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FakeFitAddon {
    kind = "fit";
    fit = vi.fn();

    constructor() {
      runtime.fits.push(this);
    }
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class FakeWebLinksAddon {
    kind = "links";
  },
}));

vi.mock("@xterm/addon-canvas", () => ({
  CanvasAddon: class FakeCanvasAddon {
    kind = "canvas";
  },
}));

vi.mock("@/features/theme/theme.store", () => ({
  useThemeStore: (selector: (state: typeof themeState) => unknown) => selector(themeState),
}));

vi.mock("@/features/settings/settings.data.store", () => {
  const useSettingsDataStore = (
    selector: (state: typeof settingsState) => unknown,
  ) => selector(settingsState);
  useSettingsDataStore.getState = () => settingsState;
  return { useSettingsDataStore };
});

vi.mock("@/lib/ipc", () => ({
  CMD: { openExternalUrl: "open_external_url" },
  invoke: vi.fn(async () => undefined),
}));

import { useXterm } from "./useXterm";

function Harness() {
  const { containerRef } = useXterm();
  return <div ref={containerRef} />;
}

async function flushRendererSchedule() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useXterm load-bearing lifecycle", () => {
  beforeEach(() => {
    runtime.events.length = 0;
    runtime.frames.length = 0;
    runtime.fits.length = 0;
    runtime.terminals.length = 0;
    runtime.width = 800;
    themeState.theme.id = "porcelain";
    themeState.effective = "light";
    settingsState.settings.accessibility.screenReaderMode = false;
    document.documentElement.style.setProperty("--term-bg", "#ffffff");
    document.documentElement.style.setProperty("--term-fg", "#111111");
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: vi.fn(async () => []) },
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => runtime.width,
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      runtime.frames.push(callback);
      return runtime.frames.length;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses explicit dimensions and loads fit then links before open", async () => {
    render(<Harness />);
    await flushRendererSchedule();

    expect(runtime.terminals[0]?.options).toMatchObject({
      cols: 100,
      rows: 28,
      lineHeight: 1,
    });
    expect(runtime.events).toEqual(["load:fit", "load:links", "open"]);
    expect(runtime.frames).toHaveLength(1);
  });

  it("defers CanvasAddon and the first fit to the scheduled frame", async () => {
    render(<Harness />);
    await flushRendererSchedule();

    expect(runtime.events).not.toContain("load:canvas");
    act(() => runtime.frames.shift()?.(0));

    expect(runtime.events).toEqual(["load:fit", "load:links", "open", "load:canvas"]);
    expect(runtime.fits[0]?.fit).toHaveBeenCalledOnce();
  });

  it("does not fit a hidden terminal", async () => {
    runtime.width = 0;
    render(<Harness />);
    await flushRendererSchedule();

    act(() => runtime.frames.shift()?.(0));

    expect(runtime.fits[0]?.fit).not.toHaveBeenCalled();
  });

  it("reapplies the terminal theme to an existing terminal", async () => {
    const view = render(<Harness />);
    await flushRendererSchedule();
    const term = runtime.terminals[0];
    expect(term?.options.theme).toMatchObject({ background: "#ffffff" });

    document.documentElement.style.setProperty("--term-bg", "#111111");
    themeState.theme.id = "graphite";
    themeState.effective = "dark";
    view.rerender(<Harness />);

    expect(term?.options.theme).toMatchObject({ background: "#111111" });
  });

  it("screen-reader setting updates existing and future terminals", async () => {
    const view = render(<Harness />);
    await flushRendererSchedule();
    expect(runtime.terminals[0]?.options.screenReaderMode).toBe(false);

    settingsState.settings.accessibility.screenReaderMode = true;
    view.rerender(<Harness />);
    expect(runtime.terminals[0]?.options.screenReaderMode).toBe(true);

    view.unmount();
    render(<Harness />);
    await flushRendererSchedule();
    expect(runtime.terminals[1]?.options.screenReaderMode).toBe(true);
  });
});
