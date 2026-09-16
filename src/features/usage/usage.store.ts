import { create } from "zustand";
import { usageApi } from "./usage.service";
import { initialSnapshot, type UsageSnapshot } from "./usage.types";

interface UsageState {
  snapshot: UsageSnapshot;
  hydrated: boolean;
  refreshing: boolean;
  configuring: boolean;
  error: boolean;
  hydrate: () => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
  connectAccount: (providerId: "cursor-cli" | "grok", title: string) => Promise<void>;
  connectCursorCookie: (cookie: string) => Promise<void>;
  disconnectAccount: (providerId: "cursor-cli" | "grok") => Promise<void>;
  setCaptureEnabled: (providerId: "claude-code" | "cursor-cli", enabled: boolean) => Promise<void>;
}

let hydration: Promise<void> | null = null;
let refreshRequest: Promise<void> | null = null;
let lastRefresh = 0;

export const useUsageStore = create<UsageState>((set, get) => ({
  snapshot: initialSnapshot(), hydrated: false, refreshing: false, configuring: false, error: false,
  hydrate: () => {
    if (get().hydrated) return Promise.resolve();
    if (hydration) return hydration;
    hydration = usageApi.read().then(snapshot => set({ snapshot, hydrated: true, error: false }))
      .catch(() => set({ error: true })).finally(() => { hydration = null; });
    return hydration;
  },
  refresh: (force = false) => {
    if (get().configuring) return Promise.resolve();
    if (refreshRequest) return refreshRequest;
    if (get().hydrated && Date.now() - lastRefresh < (force ? 15_000 : 30_000)) return Promise.resolve();
    set({ refreshing: true, error: false });
    refreshRequest = get().hydrate().then(() => usageApi.refresh(force))
      .then(snapshot => { lastRefresh = Date.now(); set({ snapshot, hydrated: true, error: false }); })
      .catch(() => { lastRefresh = Date.now(); set({ error: true }); })
      .finally(() => { refreshRequest = null; set({ refreshing: false }); });
    return refreshRequest;
  },
  connectAccount: (id, title) => configureAccount(() => usageApi.connectAccount(id, title)),
  connectCursorCookie: cookie => configureAccount(() => usageApi.connectCursorCookie(cookie)),
  disconnectAccount: id => configureAccount(() => usageApi.disconnectAccount(id)),
  setCaptureEnabled: async (providerId, enabled) => {
    if (get().configuring) return;
    set({ configuring: true, error: false });
    // Serialize the setting write after an outstanding refresh so an older
    // snapshot cannot undo a newly enabled connection in the UI.
    if (refreshRequest) await refreshRequest;
    try { set({ snapshot: await usageApi.setCaptureEnabled(providerId, enabled), hydrated: true }); }
    catch { set({ error: true }); }
    finally { set({ configuring: false }); }
  },
}));

async function configureAccount(request: () => Promise<UsageSnapshot>): Promise<void> {
  if (useUsageStore.getState().configuring) return;
  useUsageStore.setState({ configuring: true, error: false });
  if (refreshRequest) await refreshRequest;
  if (hydration) await hydration;
  let configured = false;
  try {
    useUsageStore.setState({ snapshot: await request(), hydrated: true });
    lastRefresh = 0;
    configured = true;
  } catch { useUsageStore.setState({ error: true }); }
  finally { useUsageStore.setState({ configuring: false }); }
  if (configured) await useUsageStore.getState().refresh(true);
}
