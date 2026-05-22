import { useState } from "react";
import { Copy, ExternalLink, Terminal, RefreshCw, AlertTriangle, Wrench } from "lucide-react";
import { writeText as writeClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation, Trans } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { CliTool } from "@/features/terminal/cli-registry";

interface CliMissingPanelProps {
  cli: CliTool;
  onRetry: () => void;
  onOpenInTerminal: (installCommand: string) => void;
}

export function CliMissingPanel({ cli, onRetry, onOpenInTerminal }: CliMissingPanelProps) {
  const { t } = useTranslation();
  const needsConfig = !!cli.needsConfig;

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-canvas">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-[20px] px-[32px] pt-[56px]">
        <div className="flex items-center gap-[10px]">
          <span className="editorial-caps">
            {needsConfig ? t("cli.needsConfig") : t("terminal.notInstalled")}
          </span>
          {cli.dangerLevel === "dangerous" && (
            <Badge tone="warn">
              <Icon icon={AlertTriangle} size={10} strokeWidth={2} />
              {t("cli.dangerous")}
            </Badge>
          )}
          {needsConfig && (
            <Badge tone="muted">
              <Icon icon={Wrench} size={10} />
              {t("terminal.configure")}
            </Badge>
          )}
        </div>

        <h1
          className="font-display text-[40px] font-medium tracking-[-0.015em] text-ink"
          style={{ lineHeight: 1.05 }}
        >
          {cli.label}
        </h1>

        <p className="max-w-[520px] text-[14px] leading-[1.55] text-body">{cli.description}</p>

        {needsConfig ? (
          <div className="rounded-sm border border-hairline-soft bg-canvas-soft px-[16px] py-[14px]">
            <p className="text-[13px] text-body">
              <span className="font-medium text-ink">{t("terminal.piNotConfigured")}</span>
              {t("terminal.piNotConfiguredBody")}
            </p>
            <p className="mt-[6px] font-mono text-[11px] text-muted-soft">
              metacodex.store.json · cliRegistryOverrides
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            <p className="editorial-caps">{t("terminal.installCommand")}</p>
            <InstallBlock command={cli.installCommand} />
            {cli.altInstallCommand ? (
              <>
                <p className="mt-[6px] editorial-caps">{t("terminal.orViaNpm")}</p>
                <InstallBlock command={cli.altInstallCommand} secondary />
              </>
            ) : null}
          </div>
        )}

        <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
          {!needsConfig && cli.installCommand ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => onOpenInTerminal(cli.installCommand)}
            >
              <Icon icon={Terminal} size={13} className="text-on-primary" />
              {t("terminal.openInTerminal")}
            </Button>
          ) : null}
          <Button variant="outline" size="md" onClick={onRetry}>
            <Icon icon={RefreshCw} size={12} />
            {t("terminal.retryDetection")}
          </Button>
          {cli.docsUrl ? (
            <a
              href={cli.docsUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex h-[32px] items-center gap-[6px] rounded-sm border border-hairline-strong bg-canvas px-[14px] text-[13px] font-medium text-ink",
                "hover:bg-surface-strong/40 transition-colors",
              )}
            >
              <Icon icon={ExternalLink} size={12} />
              {t("common.docs")}
            </a>
          ) : null}
        </div>

        <p className="mt-auto pb-[24px] pt-[28px] font-mono text-[11px] text-muted-soft">
          <Trans
            i18nKey="terminal.lookup"
            values={{ command: cli.command, detect: cli.detectCommand }}
            components={[<span className="text-ink" />, <span className="text-ink" />]}
          />
        </p>
      </div>
    </div>
  );
}

function InstallBlock({ command, secondary }: { command: string; secondary?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await writeClipboard(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("clipboard write failed", e);
    }
  };

  return (
    <div
      className={cn(
        "relative flex items-center gap-[10px] rounded-sm border px-[12px] py-[10px] font-mono text-[12px] leading-[1.5]",
        secondary
          ? "border-hairline bg-canvas-soft text-body"
          : "border-hairline-strong bg-canvas text-ink",
      )}
    >
      <span className="text-muted-soft">$</span>
      <code className="flex-1 select-text whitespace-pre-wrap break-words">{command}</code>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "inline-flex h-[22px] items-center gap-[4px] rounded-xs border border-hairline-soft px-[8px] text-[11px] text-muted",
          "hover:bg-surface-strong/55 hover:text-ink",
        )}
        aria-label={t("terminal.copyInstall")}
      >
        <Icon icon={Copy} size={11} />
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </div>
  );
}
