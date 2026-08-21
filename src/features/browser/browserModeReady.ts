import { browserApi, type BrowserMode } from "./browser.service";

interface ModeReadyDependencies {
  setMode: (mode: BrowserMode) => Promise<void>;
  settleBridge: () => Promise<void>;
}

const defaultDependencies: ModeReadyDependencies = {
  setMode: browserApi.setMode,
  settleBridge: () => new Promise((resolve) => setTimeout(resolve, 50)),
};

export async function setBrowserModeAfterCompositor(
  mode: BrowserMode,
  dependencies: ModeReadyDependencies = defaultDependencies,
): Promise<void> {
  await dependencies.setMode(mode);
  await dependencies.settleBridge();
}
