import { useMemo } from "react";

import { useSettingsDataStore } from "@/features/settings/settings.data.store";

import { enabledCliTools } from "./cli-registry";

/** Subscribes launcher surfaces to the single persisted enabled-agent registry. */
export function useEnabledCliTools() {
  const enabledAgents = useSettingsDataStore((state) => state.settings.interface.enabledAgents);
  return useMemo(() => enabledCliTools(enabledAgents), [enabledAgents]);
}
