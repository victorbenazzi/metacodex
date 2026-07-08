import { useCallback, useEffect, useState } from "react";
import { useTranslation, Trans } from "react-i18next";

import { TerminalTab } from "./TerminalTab";
import { CliMissingPanel } from "./CliMissingPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { cliApi } from "@/features/terminal/cli.service";
import { cliById, type CliTool } from "@/features/terminal/cli-registry";
import { useTabsStore, WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { useProjectsStore } from "@/features/projects/project.store";
import { isRemoteProject } from "@/features/projects/project.types";
import { newId } from "@/lib/idGen";

interface CliTabComponentProps {
  tabId: string;
  cwd: string;
  projectId: string | null;
  cliId: string;
  launchCommand: string;
  label: string;
  isVisible?: boolean;
}

type Status = "detecting" | "missing" | "ready";

export function CliTabComponent({
  tabId,
  cwd,
  projectId,
  cliId,
  launchCommand,
  label,
  isVisible,
}: CliTabComponentProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>("detecting");
  const openTab = useTabsStore((s) => s.openTab);
  const project = useProjectsStore((s) =>
    projectId ? s.projects.find((p) => p.id === projectId) ?? null : null,
  );
  const remoteProject = isRemoteProject(project);
  const cli: CliTool | undefined = cliById(cliId);

  const detect = useCallback(async () => {
    if (remoteProject) {
      setStatus("ready");
      return;
    }
    if (!cli) {
      setStatus("missing");
      return;
    }
    try {
      setStatus("detecting");
      const result = await cliApi.detect(cli.command);
      setStatus(result.installed ? "ready" : "missing");
    } catch (err) {
      console.warn("[cli] detect failed", err);
      setStatus("missing");
    }
  }, [cli, remoteProject]);

  useEffect(() => {
    void detect();
  }, [detect]);

  const openInstallInTerminal = useCallback(
    (installCommand: string) => {
      const projectKey = projectId ?? WORKSPACE_NULL;
      openTab(projectKey, {
        id: `t-${newId(10)}`,
        kind: "terminal",
        title: `install ${cli?.label ?? "cli"}`.slice(0, 30),
        projectId,
        cwd,
        prefillCommand: installCommand,
      });
    },
    [cwd, openTab, projectId, cli],
  );

  if (!cli || status === "missing") {
    if (!cli) {
      return (
        <div className="h-full bg-canvas">
          <EmptyState
            body={
              <span className="text-danger">
                <Trans
                  i18nKey="terminal.unknownCli"
                  values={{ id: cliId }}
                  components={[<code className="font-mono" />]}
                />
              </span>
            }
          />
        </div>
      );
    }
    return (
      <CliMissingPanel
        cli={cli}
        onRetry={detect}
        onOpenInTerminal={openInstallInTerminal}
      />
    );
  }

  if (status === "detecting") {
    return (
      <div className="h-full bg-canvas">
        <EmptyState body={t("terminal.detecting", { label: cli.label })} />
      </div>
    );
  }

  // ready — mount the real terminal
  return (
    <TerminalTab
      tabId={tabId}
      cwd={cwd}
      projectId={projectId}
      label={label}
      cliLaunchCommand={launchCommand}
      cliToolId={cliId}
      isVisible={isVisible}
    />
  );
}
