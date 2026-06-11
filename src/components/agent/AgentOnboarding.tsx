import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Check, Copy, Loader2, RefreshCw } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { DEFAULT_CLI_REGISTRY, type CliTool } from "@/features/terminal/cli-registry";
import {
  cliDetectionFor,
  refreshCliDetection,
  useCliDetections,
} from "@/features/terminal/cli-detection";

/** Resolved with a loud, debuggable failure instead of a bare `!` assertion
 *  that would crash at module load if the registry entry were ever renamed. */
function requireOpencodeCli(): CliTool {
  const cli = DEFAULT_CLI_REGISTRY.find((c) => c.id === "opencode");
  if (!cli) throw new Error("cli-registry is missing the 'opencode' entry");
  return cli;
}
export const OPENCODE_CLI = requireOpencodeCli();

/**
 * Shown in place of the chat hero when the opencode runtime could not start.
 * Two flavors: the binary is missing from PATH (install guidance, the Code
 * view never needs opencode, so this only appears when the user actually
 * opens the Agent view), or it exists but the sidecar failed (raw error +
 * retry). Retry re-probes the PATH (session-long cache) and reconnects.
 */
export function AgentOnboarding() {
  const { t } = useTranslation();
  const detections = useCliDetections();
  const detection = cliDetectionFor(OPENCODE_CLI, detections);
  const connecting = useAgentChatStore((s) => s.connecting);
  // Connection-level failure (start error), never a stale message error.
  const error = useAgentChatStore((s) => s.connectionError);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const missing = detection.status === "missing";

  const retry = () => {
    refreshCliDetection(OPENCODE_CLI);
    void useAgentChatStore.getState().connect();
  };

  const copyInstall = () => {
    navigator.clipboard
      .writeText(OPENCODE_CLI.installCommand ?? "")
      .then(() => {
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => undefined);
  };

  return (
    <EmptyState
      variant="panel"
      icon={Bot}
      title={missing ? t("agent.onboarding.missingTitle") : t("agent.onboarding.failedTitle")}
      body={
        <span className="flex flex-col items-center gap-[12px]">
          <span>
            {missing ? t("agent.onboarding.missingBody") : (error ?? t("agent.onboarding.failedBody"))}
          </span>
          {missing ? (
            <span className="flex items-center gap-[6px] rounded-md border border-hairline bg-surface-1 py-[6px] pl-[12px] pr-[6px]">
              <code className="font-mono text-caption text-ink">
                {OPENCODE_CLI.installCommand}
              </code>
              <button
                type="button"
                onClick={copyInstall}
                aria-label={t("agent.onboarding.copyInstall")}
                className="rounded-sm p-[4px] text-muted hover:bg-surface-strong/55 hover:text-ink"
              >
                <Icon icon={copied ? Check : Copy} size={12} className={copied ? "text-success" : undefined} />
              </button>
            </span>
          ) : null}
          {missing ? (
            <span className="text-caption text-muted-soft">{t("agent.onboarding.codeStillWorks")}</span>
          ) : null}
        </span>
      }
      action={
        <Button variant="primary" size="md" disabled={connecting} onClick={retry}>
          <Icon
            icon={connecting ? Loader2 : RefreshCw}
            size={13}
            className={connecting ? "animate-spin" : undefined}
          />
          {t("agent.onboarding.retry")}
        </Button>
      }
    />
  );
}
