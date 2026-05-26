import type { ComponentType, ReactNode } from "react";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Settings2,
  GitBranch,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownRoot,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/ContextMenu";
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { Tooltip } from "@/components/ui/Tooltip";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import {
  DEFAULT_CLI_REGISTRY,
  cliCategory,
  isAgentEnabled,
  type CliTool,
} from "@/features/terminal/cli-registry";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { cn } from "@/lib/cn";

interface NewTabActions {
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
  onEditRegistry?: () => void;
  /** Open the WorktreeCreateDialog flow. Only shown when a project is active. */
  onNewWorktree?: () => void;
}

// Polymorphic body — the SAME items are rendered inside a Radix DropdownMenu
// (when triggered by the "+" button) or inside a Radix ContextMenu (when
// triggered by right-clicking the tab bar background). Future tweaks to the
// launcher (new sections, ordering, badges) should live here only.
interface MenuComponents {
  Item: ComponentType<{
    onSelect?: () => void;
    trailing?: ReactNode;
    children: ReactNode;
    className?: string;
    keepOpenOnSelect?: boolean;
  }>;
  Separator: ComponentType;
  Label: ComponentType<{ children: ReactNode }>;
}

export function NewTabBody({ actions, C }: { actions: NewTabActions; C: MenuComponents }) {
  const { t } = useTranslation();
  const enabledAgents = useSettingsDataStore((s) => s.settings.interface.enabledAgents);
  const autonomousExpanded = useSettingsDataStore(
    (s) => s.settings.interface.autonomousAgentsExpanded,
  );
  const updateSettings = useSettingsDataStore((s) => s.update);
  // Roomier rows + a more legible highlight (full-opacity surface, not the
  // shared menu default of /70, which reads as almost no hover at this density).
  const itemClass = "py-[9px] data-[highlighted]:bg-surface-strong";

  const visible = DEFAULT_CLI_REGISTRY.filter((cli) => isAgentEnabled(cli.id, enabledAgents));
  const codingAgents = visible.filter((cli) => cliCategory(cli) === "coding");
  const autonomousAgents = visible.filter((cli) => cliCategory(cli) === "autonomous");

  // No install-state hint on launcher rows — the install guide surfaces inside
  // the tab via CliMissingPanel after the user clicks. Settings > CLI Registry
  // is the canonical place to inspect detection state.
  const renderAgent = (cli: CliTool) => {
    const BrandIcon = CLI_BRAND_ICONS[cli.id];
    return (
      <C.Item
        key={cli.id}
        onSelect={() => actions.onLaunchCli(cli)}
        className={itemClass}
      >
        {BrandIcon ? (
          <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center">
            <BrandIcon size={16} />
          </span>
        ) : null}
        <span className="font-medium">{cli.label}</span>
      </C.Item>
    );
  };

  return (
    <>
      <C.Item
        onSelect={actions.onNewTerminal}
        trailing={<Kbd keys={["Mod", "T"]} />}
        className={itemClass}
      >
        <span className="font-medium">{t("tabs.newTerminal")}</span>
      </C.Item>

      {actions.onNewWorktree ? (
        <C.Item onSelect={actions.onNewWorktree} className={itemClass}>
          <Icon icon={GitBranch} size={13} className="text-muted" />
          <span className="font-medium">{t("tabs.newWorktree")}</span>
        </C.Item>
      ) : null}

      {codingAgents.length > 0 && (
        <>
          <C.Separator />
          <C.Label>{t("tabs.codingAgents")}</C.Label>
          {codingAgents.map(renderAgent)}
        </>
      )}

      {autonomousAgents.length > 0 && (
        <>
          <C.Separator />
          <C.Item
            keepOpenOnSelect
            onSelect={() =>
              updateSettings("interface", { autonomousAgentsExpanded: !autonomousExpanded })
            }
            className={cn(itemClass, "uppercase tracking-[0.08em]")}
            trailing={
              <Icon
                icon={autonomousExpanded ? ChevronDown : ChevronRight}
                size={12}
                className="text-muted"
              />
            }
          >
            <span className="text-[10px] font-medium text-muted">
              {t("tabs.autonomousAgents")}
            </span>
          </C.Item>
          {autonomousExpanded && autonomousAgents.map(renderAgent)}
        </>
      )}

      {actions.onEditRegistry && (
        <>
          <C.Separator />
          <C.Item onSelect={actions.onEditRegistry} className={itemClass}>
            <Icon icon={Settings2} size={12} className="text-muted" />
            <span>{t("tabs.editRegistry")}</span>
          </C.Item>
        </>
      )}
    </>
  );
}

export const DROPDOWN_COMPONENTS: MenuComponents = {
  Item: DropdownItem,
  Separator: DropdownSeparator,
  Label: DropdownLabel,
};

const CONTEXT_COMPONENTS: MenuComponents = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Label: ContextMenuLabel,
};

export function NewTabMenu({ onNewTerminal, onLaunchCli, onEditRegistry }: NewTabActions) {
  const { t } = useTranslation();
  return (
    <DropdownRoot>
      <Tooltip content={t("tabs.newTab")} shortcut={<Kbd keys={["Mod", "T"]} />} side="bottom">
        <DropdownTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-[22px] w-[22px] items-center justify-center rounded-xs text-muted",
              "hover:bg-surface-strong/55 hover:text-ink transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink",
            )}
            aria-label={t("tabs.newTab")}
          >
            <Icon icon={Plus} size={12} />
          </button>
        </DropdownTrigger>
      </Tooltip>

      <DropdownContent align="end" sideOffset={8}>
        <NewTabBody
          actions={{ onNewTerminal, onLaunchCli, onEditRegistry }}
          C={DROPDOWN_COMPONENTS}
        />
      </DropdownContent>
    </DropdownRoot>
  );
}

interface NewTabContextMenuProps extends NewTabActions {
  children: ReactNode;
}

export function NewTabContextMenu({
  children,
  onNewTerminal,
  onLaunchCli,
  onEditRegistry,
}: NewTabContextMenuProps) {
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <NewTabBody
          actions={{ onNewTerminal, onLaunchCli, onEditRegistry }}
          C={CONTEXT_COMPONENTS}
        />
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
