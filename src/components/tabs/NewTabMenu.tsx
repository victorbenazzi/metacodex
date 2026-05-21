import { Plus, AlertTriangle, Settings2 } from "lucide-react";

import {
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownRoot,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { Tooltip } from "@/components/ui/Tooltip";
import { Badge } from "@/components/ui/Badge";
import { DEFAULT_CLI_REGISTRY, type CliTool } from "@/features/terminal/cli-registry";
import { cn } from "@/lib/cn";

interface NewTabMenuProps {
  onNewTerminal: () => void;
  onLaunchCli: (cli: CliTool) => void;
  onEditRegistry?: () => void;
}

export function NewTabMenu({ onNewTerminal, onLaunchCli, onEditRegistry }: NewTabMenuProps) {
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
        <DropdownItem onSelect={onNewTerminal} trailing={<Kbd keys={["Mod", "T"]} />}>
          <span className="font-medium">New Terminal</span>
        </DropdownItem>

        <DropdownSeparator />
        <DropdownLabel>AI CLIs</DropdownLabel>

        {DEFAULT_CLI_REGISTRY.map((cli) => (
          <DropdownItem
            key={cli.id}
            onSelect={() => onLaunchCli(cli)}
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
            <span className="flex flex-col items-start gap-[1px]">
              <span className="font-medium">{cli.label}</span>
              <span className="font-mono text-[10px] text-muted">{cli.command}</span>
            </span>
          </DropdownItem>
        ))}

        {onEditRegistry && (
          <>
            <DropdownSeparator />
            <DropdownItem onSelect={onEditRegistry}>
              <Icon icon={Settings2} size={12} className="text-muted" />
              <span>Edit CLI registry&hellip;</span>
            </DropdownItem>
          </>
        )}
      </DropdownContent>
    </DropdownRoot>
  );
}
