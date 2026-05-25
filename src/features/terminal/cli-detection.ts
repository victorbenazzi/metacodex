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

export function emptyCliDetections(registry: CliTool[] = DEFAULT_CLI_REGISTRY): CliDetections {
  return Object.fromEntries(registry.map((cli) => [cli.id, checkingState]));
}

export function useCliDetections(registry: CliTool[] = DEFAULT_CLI_REGISTRY): CliDetections {
  const [detections, setDetections] = useState<CliDetections>(() => emptyCliDetections(registry));

  useEffect(() => {
    let cancelled = false;

    setDetections(emptyCliDetections(registry));

    registry.forEach((cli) => {
      cliApi
        .detect(cli.command)
        .then((result) => {
          if (cancelled) return;
          setDetections((cur) => ({
            ...cur,
            [cli.id]: {
              ...result,
              status: result.installed ? "installed" : "missing",
            },
          }));
        })
        .catch((err) => {
          console.warn("[cli] detect failed", cli.id, err);
          if (cancelled) return;
          setDetections((cur) => ({
            ...cur,
            [cli.id]: { status: "missing", installed: false, path: null },
          }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [registry]);

  return detections;
}

export function cliDetectionFor(cli: CliTool, detections: CliDetections): CliDetectionState {
  return detections[cli.id] ?? checkingState;
}
