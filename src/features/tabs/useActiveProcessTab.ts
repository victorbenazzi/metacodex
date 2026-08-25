import { useEffect, useState } from "react";

import { isProcessTab } from "@/features/tabs";
import type { Tab } from "@/components/tabs/types";

/**
 * The center column follows the last focused CLI/terminal, even if the user
 * then opens a file (those land in the right workbench). Falls back to the
 * first process tab when the remembered one is gone.
 */
export function useActiveProcessTab(
  tabs: Tab[],
  activeTabId: string | null,
): Tab | null {
  const [processId, setProcessId] = useState<string | null>(null);

  useEffect(() => {
    const processes = tabs.filter(isProcessTab);
    setProcessId((prev) => {
      if (activeTabId && processes.some((tab) => tab.id === activeTabId)) {
        return activeTabId;
      }
      if (prev && processes.some((tab) => tab.id === prev)) return prev;
      return processes[0]?.id ?? null;
    });
  }, [tabs, activeTabId]);

  if (!processId) return null;
  return tabs.find((tab) => tab.id === processId) ?? null;
}
