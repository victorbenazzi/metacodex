import { useTranslation, Trans } from "react-i18next";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { PaneHeader } from "@/components/settings/SettingsPrimitives";
import {
  DEFAULT_CLI_REGISTRY,
  cliInstallCommand,
} from "@/features/terminal/cli-registry";
import {
  cliDetectionFor,
  useCliDetections,
  type CliDetectionStatus,
} from "@/features/terminal/cli-detection";

export function CliRegistryPane() {
  const { t } = useTranslation();
  const detections = useCliDetections();

  return (
    <div>
      <PaneHeader title={t("settings.cli.title")} description={t("settings.cli.description")} />
      <ul className="flex flex-col">
        {DEFAULT_CLI_REGISTRY.map((cli) => {
          const detection = cliDetectionFor(cli, detections);
          return (
            <li
              key={cli.id}
              className="flex items-start justify-between gap-[16px] border-b border-hairline-soft py-[12px] last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-[8px]">
                  <span className="text-ui font-medium text-ink">{cli.label}</span>
                  <CliStatusBadge status={detection.status} />
                  {cli.dangerLevel === "dangerous" && <Badge tone="warn">{t("cli.dangerous")}</Badge>}
                  {cli.needsConfig && detection.status !== "installed" ? (
                    <Badge tone="muted">{t("cli.needsConfig")}</Badge>
                  ) : null}
                </div>
                <div className="mt-[2px] font-mono text-label text-muted">
                  {t("settings.cli.command")}: {cli.command}
                </div>
                {detection.path ? (
                  <div
                    className="mt-[2px] truncate font-mono text-label text-muted-soft"
                    title={detection.path}
                  >
                    {t("settings.cli.detectedPath")}: {detection.path}
                  </div>
                ) : cliInstallCommand(cli) ? (
                  <div
                    className="mt-[2px] truncate font-mono text-label text-muted-soft"
                    title={cliInstallCommand(cli)}
                  >
                    {t("settings.cli.install")}: {cliInstallCommand(cli)}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-[16px] rounded-sm border border-hairline-soft bg-canvas-soft px-[12px] py-[10px] text-caption text-muted">
        <Trans
          i18nKey="settings.cli.overridesNote"
          values={{ file: "~/.metacodex/settings.json" }}
          components={[<span className="font-mono text-ink" />]}
        />
      </p>
    </div>
  );
}

function CliStatusBadge({ status }: { status: CliDetectionStatus }) {
  const { t } = useTranslation();

  if (status === "checking") {
    return (
      <Badge tone="muted">
        <Icon
          icon={Loader2}
          size={10}
          className="animate-spin motion-reduce:animate-none"
        />
        {t("settings.cli.statusChecking")}
      </Badge>
    );
  }

  if (status === "installed") {
    return (
      <Badge tone="success">
        <Icon icon={CheckCircle2} size={10} />
        {t("settings.cli.statusInstalled")}
      </Badge>
    );
  }

  return (
    <Badge tone="warn">
      <Icon icon={CircleAlert} size={10} />
      {t("settings.cli.statusMissing")}
    </Badge>
  );
}
