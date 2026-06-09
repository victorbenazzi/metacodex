import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { PanelShell } from "./PanelShell";

/** WebBridge: browser-use automation surface. Driving a real browser is a
 *  separate integration that lands after the core harness. */
export function WebBridgePanel() {
  const { t } = useTranslation();
  return (
    <PanelShell title={t("agent.webbridge.title")} subtitle={t("agent.webbridge.subtitle")}>
      <EmptyState
        variant="panel"
        icon={Globe}
        title={t("agent.webbridge.emptyTitle")}
        body={t("agent.webbridge.emptyBody")}
      />
    </PanelShell>
  );
}
