import { CMD, invoke } from "@/lib/ipc";

export const watcherApi = {
  watch(projectId: string, path: string): Promise<void> {
    return invoke<void>(CMD.watcherWatch, { projectId, path });
  },
  unwatch(projectId: string): Promise<void> {
    return invoke<void>(CMD.watcherUnwatch, { projectId });
  },
};
