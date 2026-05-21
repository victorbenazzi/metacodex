import type { ComponentType, ReactNode } from "react";
import { Plus, AlertTriangle, Settings2 } from "lucide-react";

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
import { Badge } from "@/components/ui/Badge";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import { DEFAULT_CLI_REGISTRY, type CliTool } from "@/features/terminal/cli-registry";
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
  }>;
  Separator: ComponentType;
  Label: ComponentType<{ children: ReactNode }>;
}

function NewTabBody({ actions, C }: { actions: NewTabActions; C: MenuComponents }) {
  return (
    <>
      <C.Item onSelect={actions.onNewTerminal} trailing={<Kbd keys={["Mod", "T"]} />}>
        <span className="font-medium">New Terminal</span>
      </C.Item>

      <C.Separator />
      <C.Label>AI CLIs</C.Label>

      {DEFAULT_CLI_REGISTRY.map((cli) => {
        const BrandIcon = CLI_BRAND_ICONS[cli.id];
        return (
          <C.Item
            key={cli.id}
            onSelect={() => actions.onLaunchCli(cli)}
            trailing={
              cli.dangerLevel === "dangerous" ? (
                <Badge tone="warn" className="gap-[3px]">
                  <Icon icon={AlertTriangle} size={10} strokeWidth={2} />
                  dangerous
                </Badge>
              ) : cli.needsConfig ? (
                <Badge tone="muted">needs config</Badge>
              ) : null
            }
          >
            {BrandIcon ? (
              <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center">
                <BrandIcon size={16} />
              </span>
            ) : null}
            <span className="flex flex-col items-start gap-[1px]">
              <span className="font-medium">{cli.label}</span>
              <span className="font-mono text-[10px] text-muted">{cli.command}</span>
            </span>
          </C.Item>
        );
      })}

      {actions.onEditRegistry && (
        <>
          <C.Separator />
          <C.Item onSelect={actions.onEditRegistry}>
            <Icon icon={Settings2} size={12} className="text-muted" />
            <span>Edit CLI registry&hellip;</span>
          </C.Item>
        </>
      )}
    </>
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
  return (
    <DropdownRoot>
      <Tooltip content="New tab" shortcut={<Kbd keys={["Mod", "T"]} />} side="bottom">
        <DropdownTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-[22px] w-[22px] items-center justify-center rounded-xs text-muted",
              "hover:bg-surface-strong/55 hover:text-ink transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink",
            )}
            aria-label="New tab"
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
