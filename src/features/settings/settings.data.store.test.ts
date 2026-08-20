import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics.store";

const mocks = vi.hoisted(() => ({
  read: vi.fn(async () => null),
  write: vi.fn(async (_settings: unknown) => undefined),
}));

vi.mock("./settings.service", () => ({ settingsApi: mocks }));

import { flushSettings, useSettingsDataStore } from "./settings.data.store";
import { DEFAULT_SETTINGS } from "./settings.types";

describe("settings persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.read.mockClear();
    mocks.write.mockReset();
    mocks.write.mockResolvedValue(undefined);
    useDiagnosticsStore.getState().clear();
    useSettingsDataStore.setState({ settings: DEFAULT_SETTINGS, hydrated: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a failed background save and retries it during flush", async () => {
    mocks.write.mockRejectedValueOnce(new Error("disk unavailable"));
    useSettingsDataStore.getState().update("editor", { fontSize: 17 });

    await vi.advanceTimersByTimeAsync(400);
    expect(useDiagnosticsStore.getState().entries.at(-1)?.kind).toBe("settings.save.fail");

    await flushSettings();
    expect(mocks.write).toHaveBeenCalledTimes(2);
    const lastSettings = mocks.write.mock.calls.at(-1)?.[0] as typeof DEFAULT_SETTINGS | undefined;
    expect(lastSettings?.editor.fontSize).toBe(17);
  });
});
