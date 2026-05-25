import { useEffect, useState } from "react";

import type { CliTool } from "@/features/terminal/cli-registry";
import { DEFAULT_CLI_REGISTRY } from "@/features/terminal/cli-registry";
import { cliApi, type CliDetectResult } from "@/features/terminal/cli.service";

export type CliDetectionStatus = "checking" | "installed" | "missing";

export interface CliDetectionState extends CliDetectResult {
  status: CliDetectionStatus;
}

export type CliDetections = Record<string, CliDetectionState>;

const checkingState: CliDetectionState = {
  status: "checking",
  installed: false,
  path: null,
};

// Detection round-trips through a login shell (`$SHELL -l -c "command -v ..."`)
// which re-sources .zshrc / nvm / mise — slow enough on macOS that running it
// on every menu open shows a visible spinner per CLI. We cache results at the
// module level for the lifetime of the app: each CLI is probed at most once
// per session, results are shared across every mount of the hook, and the menu
// reopens render the cached snapshot synchronously.
const cache = new Map<string, CliDetectionState>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function ensureDetected(cli: CliTool) {
  if (cache.has(cli.id) || inflight.has(cli.id)) return;
  const p = cliApi
    .detect(cli.command)
    .then(
      (result) => {
        cache.set(cli.id, {
          ...result,
          status: result.installed ? "installed" : "missing",
        });
      },
      (err) => {
        console.warn("[cli] detect failed", cli.id, err);
        cache.set(cli.id, { status: "missing", installed: false, path: null });
      },
    )
    .finally(() => {
      inflight.delete(cli.id);
      notify();
    });
  inflight.set(cli.id, p);
}

function snapshot(registry: CliTool[]): CliDetections {
  const out: CliDetections = {};
  for (const cli of registry) {
    out[cli.id] = cache.get(cli.id) ?? checkingState;
  }
  return out;
}

export function emptyCliDetections(registry: CliTool[] = DEFAULT_CLI_REGISTRY): CliDetections {
  return Object.fromEntries(registry.map((cli) => [cli.id, checkingState]));
}

/**
 * Kick off detection for every CLI in `registry` ahead of any UI that needs
 * it. Safe to call multiple times — already-cached or in-flight entries are
 * skipped. Wire this into app startup so the first menu open is instant.
 */
export function preloadCliDetections(registry: CliTool[] = DEFAULT_CLI_REGISTRY): void {
  for (const cli of registry) ensureDetected(cli);
}

export function useCliDetections(registry: CliTool[] = DEFAULT_CLI_REGISTRY): CliDetections {
  const [, force] = useState(0);

  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    preloadCliDetections(registry);
    return () => {
      listeners.delete(listener);
    };
  }, [registry]);

  return snapshot(registry);
}

export function cliDetectionFor(cli: CliTool, detections: CliDetections): CliDetectionState {
  return detections[cli.id] ?? checkingState;
}
