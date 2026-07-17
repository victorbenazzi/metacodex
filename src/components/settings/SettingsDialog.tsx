import { useState } from "react";
import * as RD from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import {
  Sliders,
  Palette,
  FileCode,
  SquareTerminal,
  Keyboard,
  Gauge,
  Terminal,
  Info,
  LayoutPanelLeft,
  Bell,
  PersonStanding,
  X,
  type IconComponent,
} from "@/components/ui/icons";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";
import { GeneralPane } from "@/components/settings/panes/GeneralPane";
import { AppearancePane } from "@/components/settings/panes/AppearancePane";
import { InterfacePane } from "@/components/settings/panes/InterfacePane";
import { AccessibilityPane } from "@/components/settings/panes/AccessibilityPane";
import { EditorPane } from "@/components/settings/panes/EditorPane";
import { TerminalPane } from "@/components/settings/panes/TerminalPane";
import { NotificationsPane } from "@/components/settings/panes/NotificationsPane";
import { ShortcutsPane } from "@/components/settings/panes/ShortcutsPane";
import { AdvancedPane } from "@/components/settings/panes/AdvancedPane";
import { CliRegistryPane } from "@/components/settings/panes/CliRegistryPane";
import { AboutPane } from "@/components/settings/panes/AboutPane";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CategoryId =
  | "general"
  | "appearance"
  | "interface"
  | "accessibility"
  | "editor"
  | "terminal"
  | "notifications"
  | "shortcuts"
  | "advanced"
  | "cli"
  | "about";

interface Category {
  id: CategoryId;
  labelKey: string;
  icon: IconComponent;
}

const CATEGORIES: Category[] = [
  { id: "general", labelKey: "settings.nav.general", icon: Sliders },
  { id: "appearance", labelKey: "settings.nav.appearance", icon: Palette },
  { id: "interface", labelKey: "settings.nav.interface", icon: LayoutPanelLeft },
  { id: "accessibility", labelKey: "settings.nav.accessibility", icon: PersonStanding },
  { id: "editor", labelKey: "settings.nav.editor", icon: FileCode },
  { id: "terminal", labelKey: "settings.nav.terminal", icon: SquareTerminal },
  { id: "notifications", labelKey: "settings.nav.notifications", icon: Bell },
  { id: "shortcuts", labelKey: "settings.nav.shortcuts", icon: Keyboard },
  { id: "advanced", labelKey: "settings.nav.advanced", icon: Gauge },
  { id: "cli", labelKey: "settings.nav.cli", icon: Terminal },
  { id: "about", labelKey: "settings.nav.about", icon: Info },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<CategoryId>("general");

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay
          className={cn(
            "fixed inset-0 z-[100] bg-scrim",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        <RD.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2",
            "h-[min(640px,90vh)] w-[min(880px,92vw)] overflow-hidden rounded-lg border border-hairline bg-surface-card shadow-elevated",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
          aria-describedby={undefined}
        >
          <RD.Title className="sr-only">metacodex settings</RD.Title>

          <header className="relative flex h-[48px] items-center justify-between border-b border-hairline-soft px-20px">
            <div className="flex items-center gap-12px">
              <span className="editorial-caps">{t("settings.header")}</span>
              <span className="font-mono text-label text-muted-soft">metacodex</span>
            </div>
            <RD.Close asChild>
              <IconButton aria-label={t("settings.close")}>
                <Icon icon={X} size={14} />
              </IconButton>
            </RD.Close>
          </header>

          <div className="grid h-[calc(100%-48px)] grid-cols-[200px_1fr]">
            <aside className="flex flex-col gap-[1px] overflow-y-auto border-r border-hairline-soft bg-canvas-soft p-10px">
              {CATEGORIES.map((c) => (
                <SidebarRow
                  key={c.id}
                  category={c}
                  active={selected === c.id}
                  onClick={() => setSelected(c.id)}
                />
              ))}
            </aside>

            <section className="overflow-y-auto px-32px py-26px">
              {selected === "general" && <GeneralPane />}
              {selected === "appearance" && <AppearancePane />}
              {selected === "interface" && <InterfacePane />}
              {selected === "accessibility" && <AccessibilityPane />}
              {selected === "editor" && <EditorPane />}
              {selected === "terminal" && <TerminalPane />}
              {selected === "notifications" && <NotificationsPane />}
              {selected === "shortcuts" && <ShortcutsPane />}
              {selected === "advanced" && <AdvancedPane />}
              {selected === "cli" && <CliRegistryPane />}
              {selected === "about" && <AboutPane />}
            </section>
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function SidebarRow({
  category,
  active,
  onClick,
}: {
  category: Category;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-10px rounded-sm px-10px py-7px text-left transition-colors",
        active
          ? "bg-surface-strong/70 text-ink"
          : "text-body hover:bg-surface-strong/40 hover:text-ink",
      )}
    >
      <Icon icon={category.icon} size={14} className={active ? "text-ink" : "text-muted"} />
      <span className="text-ui font-medium">{t(category.labelKey)}</span>
    </button>
  );
}
