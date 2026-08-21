// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("browser drawing cursor", () => {
  it("forces one stable crosshair cursor across page elements while drawing", () => {
    const shadowHost = document.createElement("div");
    const shadowButton = document.createElement("button");
    shadowButton.style.cursor = "pointer";
    shadowHost.attachShadow({ mode: "open" }).appendChild(shadowButton);
    document.body.appendChild(shadowHost);

    vi.spyOn(window, "open").mockImplementation(() => null);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    const path = join(process.cwd(), "src-tauri/src/commands/browser_init.js");
    const script = readFileSync(path, "utf8");
    window.eval(script);

    const controls = (window as unknown as Window & {
      __mcx: { setMode: (token: string, mode: string) => boolean };
    }).__mcx;
    controls.setMode("__MCX_BRIDGE_TOKEN__", "draw");

    expect(document.documentElement).toHaveClass("__mcx-crosshair");
    expect(document.getElementById("__mcx-cursor-style")?.textContent).toContain(
      "cursor:crosshair!important",
    );
    const canvas = document.querySelector<HTMLCanvasElement>("#__mcx-overlay canvas");
    expect(canvas?.style.pointerEvents).toBe("auto");
    expect(canvas?.style.cursor).toBe("crosshair");
    expect(canvas?.style.getPropertyPriority("cursor")).toBe("important");

    controls.setMode("__MCX_BRIDGE_TOKEN__", "browse");
    expect(document.documentElement).not.toHaveClass("__mcx-crosshair");
  });
});
