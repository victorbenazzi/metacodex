import { create } from "zustand";

import { CMD, invoke } from "@/lib/ipc";

import { useAgentChatStore } from "./chat.store";
import { errMessage } from "./oc";
import { useAgentRuntimeStore, type RuntimeStatus } from "./runtime.store";

/**
 * MCP server registry mirror (Rust `McpStore` owns the truth, persisted to
 * `~/.metacodex/state/agent-mcp.json`). Secrets never reach this store: env
 * and header values arrive as the `__metacodex_redacted__` sentinel and are
 * round-tripped as-is on save unless the user types a new one.
 *
 * Config changes only land in opencode after a sidecar restart, mutations
 * latch `pendingRestart`; `restart()` is always user-triggered (it drops live
 * SSE streams and `--port 0` means a NEW base URL, which is re-bound here).
 */

export const REDACTED = "__metacodex_redacted__";

export type FeaturedId = "brave" | "exa";

export interface McpServerEntry {
  id: string;
  name: string;
  kind: "local" | "remote";
  command?: string[];
  environment?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  featured?: FeaturedId;
}

/** Create/update payload (id absent = create). */
export type McpServerInput = Omit<McpServerEntry, "id"> & { id?: string };

export interface FeaturedServerDef {
  featured: FeaturedId;
  name: string;
  displayName: string;
  descriptionKey: string;
  envVar: string;
  command: string[];
}

interface McpMutationResult {
  entry: McpServerEntry | null;
  requiresRestart: boolean;
}

export type McpStatusMap = Record<string, { status?: string; error?: string }>;

interface McpState {
  entries: McpServerEntry[];
  featured: FeaturedServerDef[];
  /** Live per-server status from the sidecar; null = unavailable (sidecar
   *  down, or an opencode too old to expose GET /mcp). */
  status: McpStatusMap | null;
  loaded: boolean;
  /** A mutation landed while the sidecar runs the old config. */
  pendingRestart: boolean;
  restarting: boolean;
  error: string | null;

  load: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  upsert: (input: McpServerInput) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  restart: () => Promise<void>;
}

export const useAgentMcpStore = create<McpState>((set, get) => ({
  entries: [],
  featured: [],
  status: null,
  loaded: false,
  pendingRestart: false,
  restarting: false,
  error: null,

  load: async () => {
    try {
      const [entries, featured] = await Promise.all([
        invoke<McpServerEntry[]>(CMD.agentMcpList),
        invoke<FeaturedServerDef[]>(CMD.agentMcpFeatured),
      ]);
      set({ entries, featured, loaded: true, error: null });
      void get().refreshStatus();
    } catch (e) {
      set({ error: errMessage(e), loaded: true });
    }
  },

  refreshStatus: async () => {
    try {
      // Scoped to the active project instance, like every other opencode call.
      const directory = useAgentChatStore.getState().directory;
      const status = await invoke<McpStatusMap | null>(CMD.agentMcpStatus, { directory });
      set({ status });
    } catch {
      // best-effort; the configured/enabled state still renders
    }
  },

  upsert: async (input) => {
    try {
      const res = await invoke<McpMutationResult>(CMD.agentMcpUpsert, { input });
      set((s) => {
        const entry = res.entry;
        if (!entry) return { pendingRestart: s.pendingRestart || res.requiresRestart };
        const idx = s.entries.findIndex((e) => e.id === entry.id);
        const entries =
          idx === -1 ? [...s.entries, entry] : s.entries.map((e, i) => (i === idx ? entry : e));
        return {
          entries,
          error: null,
          pendingRestart: s.pendingRestart || res.requiresRestart,
        };
      });
      return true;
    } catch (e) {
      set({ error: errMessage(e) });
      return false;
    }
  },

  remove: async (id) => {
    try {
      const res = await invoke<McpMutationResult>(CMD.agentMcpDelete, { id });
      set((s) => ({
        entries: s.entries.filter((e) => e.id !== id),
        error: null,
        pendingRestart: s.pendingRestart || res.requiresRestart,
      }));
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  setEnabled: async (id, enabled) => {
    // Optimistic toggle; rolled back on failure.
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, enabled } : e)),
    }));
    try {
      const res = await invoke<McpMutationResult>(CMD.agentMcpSetEnabled, { id, enabled });
      set((s) => ({ pendingRestart: s.pendingRestart || res.requiresRestart, error: null }));
    } catch (e) {
      set((s) => ({
        entries: s.entries.map((x) => (x.id === id ? { ...x, enabled: !enabled } : x)),
        error: errMessage(e),
      }));
    }
  },

  restart: async () => {
    set({ restarting: true, error: null });
    try {
      const status = await invoke<RuntimeStatus>(CMD.agentRuntimeRestart);
      // Every consumer holding the old base URL must re-resolve: runtime
      // status, the chat SSE stream, and the sessions mirror.
      useAgentRuntimeStore.setState({ status });
      if (status.baseUrl) useAgentChatStore.getState().rebindBase(status.baseUrl);
      set({ pendingRestart: false });
      // Local MCP servers (npx ...) cold-start after the spawn; one immediate
      // poll would freeze the dots on "pending". Re-poll with backoff.
      void get().refreshStatus();
      for (const delay of [2000, 5000, 10000]) {
        setTimeout(() => void get().refreshStatus(), delay);
      }
    } catch (e) {
      set({ error: errMessage(e) });
    } finally {
      set({ restarting: false });
    }
  },
}));
