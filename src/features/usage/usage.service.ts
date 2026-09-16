import { CMD, invoke } from "@/lib/ipc";
import type { UsageSnapshot } from "./usage.types";

export const usageApi = {
  connectAccount: (providerId: "cursor-cli" | "grok", title: string) => invoke<UsageSnapshot>(CMD.usageConnectAccount, { providerId, title }),
  connectCursorCookie: (cookie: string) => invoke<UsageSnapshot>(CMD.usageConnectCursorCookie, { cookie }),
  disconnectAccount: (providerId: "cursor-cli" | "grok") => invoke<UsageSnapshot>(CMD.usageDisconnectAccount, { providerId }),
  read: () => invoke<UsageSnapshot>(CMD.usageRead),
  refresh: (force = false) => invoke<UsageSnapshot>(CMD.usageRefresh, { force }),
  setCaptureEnabled: (providerId: "claude-code" | "cursor-cli", enabled: boolean) => invoke<UsageSnapshot>(CMD.usageSetCaptureEnabled, { providerId, enabled }),
};
