import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ptyApi } from "@/features/terminal/terminal.service";
import { useToastStore } from "@/features/ui/toast.store";
import { isAppError } from "@/lib/ipc";

import type { DevServer } from "./devServers";

export function useDevServerActions(servers: DevServer[]) {
  const { t } = useTranslation();
  const [stoppingServerIds, setStoppingServerIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const live = new Set(servers.map((server) => server.id));
    setStoppingServerIds((current) => {
      const next = new Set(Array.from(current).filter((id) => live.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [servers]);

  const stopServer = useCallback(async (server: DevServer) => {
    if (!server.pid || stoppingServerIds.has(server.id)) return;
    setStoppingServerIds((current) => new Set(current).add(server.id));
    try {
      await ptyApi.killProcess(server.sessionId, server.pid);
      useToastStore.getState().push({
        tone: "success",
        title: t("browser.serverStopped"),
      });
    } catch (error) {
      setStoppingServerIds((current) => {
        const next = new Set(current);
        next.delete(server.id);
        return next;
      });
      useToastStore.getState().push({
        tone: "error",
        title: t("browser.stopServerFailed"),
        detail: isAppError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }, [stoppingServerIds, t]);

  return { stoppingServerIds, stopServer };
}
