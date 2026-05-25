import type { ComponentType, ReactNode } from "react";
import { Plus, AlertTriangle, Loader2, Settings2 } from "lucide-react";
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
import { DEFAULT_CLI_REGISTRY, type CliTool } from "@/features/terminal/cli-registry";
import {
  cliDetectionFor,
  useCliDetections,
  type CliDetectionStatus,
} from "@/features/terminal/cli-detection";
import { cn } from "@/lib/cn";

interface NewTabActions {
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
  onEditRegistry?: () => void;
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
  }>;
  Separator: ComponentType;
  Label: ComponentType<{ children: ReactNode }>;
}

function NewTabBody({ actions, C }: { actions: NewTabActions; C: MenuComponents }) {
  const { t } = useTranslation();
  const detections = useCliDetections();
  // Roomier rows + a more legible highlight (full-opacity surface, not the
  // shared menu default of /70, which reads as almost no hover at this density).
  const itemClass = "py-[9px] data-[highlighted]:bg-surface-strong";
  return (
    <>
      <C.Item
        onSelect={actions.onNewTerminal}
        trailing={<Kbd keys={["Mod", "T"]} />}
        className={itemClass}
      >
        <span className="font-medium">{t("tabs.newTerminal")}</span>
      </C.Item>

      <C.Separator />
      <C.Label>{t("tabs.aiClis")}</C.Label>

      {DEFAULT_CLI_REGISTRY.map((cli) => {
        const BrandIcon = CLI_BRAND_ICONS[cli.id];
        const detection = cliDetectionFor(cli, detections);
        return (
          <C.Item
            key={cli.id}
            onSelect={() => actions.onLaunchCli(cli)}
            className={itemClass}
            trailing={<CliInstallHint status={detection.status} />}
          >
            {BrandIcon ? (
              <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center">
                <BrandIcon size={16} />
              </span>
            ) : null}
            <span className="font-medium">{cli.label}</span>
          </C.Item>
        );
      })}

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

function CliInstallHint({ status }: { status: CliDetectionStatus }) {
  const { t } = useTranslation();

  if (status === "installed") return null;

  if (status === "checking") {
    return (
      <Tooltip content={t("cli.checkingTooltip")} side="top">
        <span className="inline-flex items-center justify-center text-muted-soft">
          <Icon icon={Loader2} size={13} className="animate-spin" />
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={t("cli.notInstalledTooltip")} side="top">
      <span className="inline-flex items-center justify-center text-warn">
        <Icon icon={AlertTriangle} size={13} strokeWidth={2} />
      </span>
    </Tooltip>
  );
}

const DROPDOWN_COMPONENTS: MenuComponents = {
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
