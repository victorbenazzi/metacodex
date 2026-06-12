import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { BookOpen, Plug, ShieldCheck, Wrench } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { LateralTabs } from "@/components/ui/LateralTabs";
import { useAgentNavStore, type CustomizeTab } from "@/features/agent/nav.store";
import { SectionHeader } from "./PanelShell";
import { SkillsSection } from "./SkillsPanel";
import { McpSection } from "./McpPanel";
import { PermissionsSection } from "./PermissionsPanel";

const TABS: { id: CustomizeTab; icon: LucideIcon; labelKey: string }[] = [
  { id: "skills", icon: BookOpen, labelKey: "agent.sidebar.skills" },
  { id: "mcp", icon: Plug, labelKey: "agent.sidebar.mcp" },
  { id: "permissions", icon: ShieldCheck, labelKey: "agent.customize.permissions" },
  { id: "tools", icon: Wrench, labelKey: "agent.customize.tools" },
];

/**
 * Customize: one page for everything that extends the agent (Skills, MCP
 * Servers, Tools). Same chrome as the other Work panels, plus a sticky lateral
 * tab rail mirroring the Settings dialog navigation.
 */
export function CustomizePanel() {
  const { t } = useTranslation();
  const tab = useAgentNavStore((s) => s.customizeTab);
  const openCustomize = useAgentNavStore((s) => s.openCustomize);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[980px] px-[28px] py-[28px]">
        <header className="mb-[20px]">
          <h1 className="font-display text-[24px] tracking-[-0.01em] text-ink">
            {t("agent.customize.title")}
          </h1>
          <p className="mt-[4px] text-ui text-muted">{t("agent.customize.subtitle")}</p>
        </header>

        <div className="flex items-start gap-[28px]">
          <LateralTabs
            tabs={TABS.map(({ id, icon, labelKey }) => ({ id, icon, label: t(labelKey) }))}
            value={tab}
            onChange={(id) => openCustomize(id)}
            ariaLabel={t("agent.customize.tabsLabel")}
            className="w-[176px]"
          />

          <div className="min-w-0 flex-1">
            {tab === "skills" ? (
              <SkillsSection />
            ) : tab === "mcp" ? (
              <McpSection />
            ) : tab === "permissions" ? (
              <PermissionsSection />
            ) : (
              <ToolsSection />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tools: per-tool enable/disable for the agent runtime. Scaffold only; the
 *  toggle surface lands once opencode exposes its tool registry over HTTP. */
function ToolsSection() {
  const { t } = useTranslation();
  return (
    <section>
      <SectionHeader title={t("agent.tools.title")} subtitle={t("agent.tools.subtitle")} />
      <EmptyState
        variant="panel"
        icon={Wrench}
        title={t("agent.tools.emptyTitle")}
        body={t("agent.tools.emptyBody")}
      />
    </section>
  );
}
