import { useEffect, useRef, useState, type ReactNode } from "react";
import * as RD from "@radix-ui/react-dialog";
import { useTranslation, Trans } from "react-i18next";
import {
  ArrowUpRight,
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
  Bot,
  Boxes,
  X,
  Sun,
  Moon,
  Laptop,
  RotateCcw,
  RefreshCw,
  Download,
  CheckCircle2,
  CircleAlert,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";

import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { Select, type SelectOption } from "@/components/ui/Select";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { cn } from "@/lib/cn";
import { CMD, invoke } from "@/lib/ipc";
import { useThemeStore, type ThemeMode } from "@/features/theme/theme.store";
import { ThemePicker } from "@/components/settings/ThemePicker";
import { SUPPORTED_LANGUAGES } from "@/features/i18n/config";
import { CLI_BRAND_ICONS } from "@/components/icons/brand";
import {
  DEFAULT_CLI_REGISTRY,
  cliCategory,
  isAgentEnabled,
} from "@/features/terminal/cli-registry";
import {
  cliDetectionFor,
  useCliDetections,
  type CliDetectionStatus,
} from "@/features/terminal/cli-detection";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { useSettingsStore, type SettingsTab } from "@/features/settings/settings.store";
import { useAgentRuntimeStore } from "@/features/agent/runtime.store";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  isModelEnabled,
  modelKey,
  type ExplorerIconStyle,
  type TerminalCursorStyle,
  type UiDensity,
} from "@/features/settings/settings.types";
import { COMMANDS, COMMANDS_BY_ID } from "@/features/keybindings/commands";
import { useKeybindingsStore } from "@/features/keybindings/keybindings.store";
import {
  bindingToKbdTokens,
  eventToBinding,
  formatBinding,
  isModifierOnly,
} from "@/features/keybindings/binding";
import type { CommandDef, CommandId } from "@/features/keybindings/types";
import { useUpdatesStore } from "@/features/updates/updates.store";
import {
  checkForUpdatesManual,
  startInstall,
} from "@/features/updates/updates.service";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CategoryId =
  | "general"
  | "appearance"
  | "interface"
  | "editor"
  | "terminal"
  | "notifications"
  | "shortcuts"
  | "advanced"
  | "agent"
  | "agent-models"
  | "cli"
  | "about";

interface Category {
  id: CategoryId;
  labelKey: string;
  icon: LucideIcon;
}

/** The two top-level tabs (mirrors the TitleBar's Agent | Code identity):
 *  workspace settings vs everything that drives the Agent View. */
const CATEGORIES_BY_TAB: Record<SettingsTab, Category[]> = {
  code: [
    { id: "general", labelKey: "settings.nav.general", icon: Sliders },
    { id: "appearance", labelKey: "settings.nav.appearance", icon: Palette },
    { id: "interface", labelKey: "settings.nav.interface", icon: LayoutPanelLeft },
    { id: "editor", labelKey: "settings.nav.editor", icon: FileCode },
    { id: "terminal", labelKey: "settings.nav.terminal", icon: SquareTerminal },
    { id: "notifications", labelKey: "settings.nav.notifications", icon: Bell },
    { id: "shortcuts", labelKey: "settings.nav.shortcuts", icon: Keyboard },
    { id: "advanced", labelKey: "settings.nav.advanced", icon: Gauge },
    { id: "cli", labelKey: "settings.nav.cli", icon: Terminal },
    { id: "about", labelKey: "settings.nav.about", icon: Info },
  ],
  agent: [
    { id: "agent", labelKey: "agent.settings.navLabel", icon: Bot },
    { id: "agent-models", labelKey: "agent.settings.navModels", icon: Boxes },
  ],
};

/** Curated monospace families. Stored value is the CSS font stack. */
const EDITOR_FONT_OPTIONS: SelectOption[] = [
  { value: "var(--font-mono)", label: "JetBrains Mono" },
  { value: '"SF Mono", ui-monospace, monospace', label: "SF Mono" },
  { value: "Menlo, monospace", label: "Menlo" },
  { value: "Monaco, monospace", label: "Monaco" },
  { value: '"Fira Code", monospace', label: "Fira Code" },
  { value: '"Cascadia Code", monospace', label: "Cascadia Code" },
];

const TERMINAL_FONT_OPTIONS: SelectOption[] = [
  { value: DEFAULT_TERMINAL_FONT_FAMILY, label: "JetBrains Mono Nerd Font" },
  { value: '"SF Mono", ui-monospace, monospace', label: "SF Mono" },
  { value: "Menlo, monospace", label: "Menlo" },
  { value: "Monaco, monospace", label: "Monaco" },
  { value: '"Hack Nerd Font Mono", monospace', label: "Hack Nerd Font" },
  { value: '"FiraCode Nerd Font Mono", monospace', label: "Fira Code Nerd Font" },
];

/** Ensure the active value always has a matching option (e.g. hand-edited
 *  settings.json with a family not in our curated list). */
function withCurrent(options: SelectOption[], value: string): SelectOption[] {
  return options.some((o) => o.value === value) ? options : [{ value, label: value }, ...options];
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useTranslation();
  const tab = useSettingsStore((s) => s.tab);
  const setTab = useSettingsStore((s) => s.setTab);
  const [selected, setSelected] = useState<CategoryId>("general");

  // Keep the selected category inside the active tab (also covers opening
  // straight onto the Agent tab via the Agent view's gear).
  useEffect(() => {
    const categories = CATEGORIES_BY_TAB[tab];
    if (!categories.some((c) => c.id === selected)) setSelected(categories[0].id);
  }, [tab, selected]);

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

          <header className="relative flex h-[48px] items-center justify-between border-b border-hairline-soft px-[20px]">
            <div className="flex items-center gap-[12px]">
              <span className="editorial-caps">{t("settings.header")}</span>
              <span className="font-mono text-[11px] text-muted-soft">metacodex</span>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2">
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { id: "code" as SettingsTab, label: t("settings.tab.code"), icon: FileCode },
                  { id: "agent" as SettingsTab, label: t("settings.tab.agent"), icon: Bot },
                ]}
              />
            </div>
            <RD.Close asChild>
              <button
                type="button"
                aria-label={t("settings.close")}
                className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-xs text-muted hover:bg-surface-strong/55 hover:text-ink"
              >
                <Icon icon={X} size={13} />
              </button>
            </RD.Close>
          </header>

          <div className="grid h-[calc(100%-48px)] grid-cols-[200px_1fr]">
            <aside className="flex flex-col gap-[1px] overflow-y-auto border-r border-hairline-soft bg-canvas-soft p-[10px]">
              {CATEGORIES_BY_TAB[tab].map((c) => (
                <SidebarRow
                  key={c.id}
                  category={c}
                  active={selected === c.id}
                  onClick={() => setSelected(c.id)}
                />
              ))}
            </aside>

            <section className="overflow-y-auto px-[32px] py-[26px]">
              {selected === "general" && <GeneralPane />}
              {selected === "appearance" && <AppearancePane />}
              {selected === "interface" && <InterfacePane />}
              {selected === "editor" && <EditorPane />}
              {selected === "terminal" && <TerminalPane />}
              {selected === "notifications" && <NotificationsPane />}
              {selected === "shortcuts" && <ShortcutsPane />}
              {selected === "advanced" && <AdvancedPane />}
              {selected === "agent" && <AgentPane />}
              {selected === "agent-models" && <AgentModelsPane />}
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
        "flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[7px] text-left transition-colors",
        active
          ? "bg-surface-strong/70 text-ink"
          : "text-body hover:bg-surface-strong/40 hover:text-ink",
      )}
    >
      <Icon icon={category.icon} size={13} className={active ? "text-ink" : "text-muted"} />
      <span className="text-[13px] font-medium">{t(category.labelKey)}</span>
    </button>
  );
}

function PaneHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-[20px]">
      <h2 className="font-display text-[22px] font-medium tracking-[-0.005em] text-ink">
        {title}
      </h2>
      {description ? <p className="mt-[4px] text-[13px] text-muted">{description}</p> : null}
    </header>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-[20px] border-b border-hairline-soft py-[14px] last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {hint ? <div className="mt-[2px] text-[12px] text-muted">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Inline segmented button group (matches the theme/language pickers). */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-[6px]">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-[30px] items-center gap-[6px] rounded-sm border px-[10px] text-[12px] transition-colors",
              active
                ? "border-ink bg-ink text-on-primary"
                : "border-hairline-strong text-ink hover:bg-surface-strong/45",
            )}
          >
            {opt.icon ? (
              <Icon icon={opt.icon} size={12} className={active ? "text-on-primary" : ""} />
            ) : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function GeneralPane() {
  const { t, i18n } = useTranslation();

  return (
    <div>
      <PaneHeader title={t("settings.general.title")} description={t("settings.general.description")} />

      <Row label={t("settings.general.language")} hint={t("settings.general.languageHint")}>
        <div className="flex gap-[6px]">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = i18n.language === lang.id;
            return (
              <button
                key={lang.id}
                type="button"
                onClick={() => void i18n.changeLanguage(lang.id)}
                className={cn(
                  "inline-flex h-[30px] items-center rounded-sm border px-[12px] text-[12px] transition-colors",
                  active
                    ? "border-ink bg-ink text-on-primary"
                    : "border-hairline-strong text-ink hover:bg-surface-strong/45",
                )}
                aria-pressed={active}
              >
                {lang.native}
              </button>
            );
          })}
        </div>
      </Row>

      <Row label={t("settings.general.projectStorage")} hint={t("settings.general.projectStorageHint")}>
        <span className="font-mono text-[11px] text-muted">~/.metacodex</span>
      </Row>

      <Row label={t("settings.general.saveWorkspace")} hint={t("settings.general.saveWorkspaceHint")}>
        <Badge>{t("settings.general.alwaysOn")}</Badge>
      </Row>

      <Row label={t("settings.general.restoreTerminals")} hint={t("settings.general.restoreTerminalsHint")}>
        <Badge>{t("settings.general.off")}</Badge>
      </Row>
    </div>
  );
}

function AppearancePane() {
  const { t } = useTranslation();
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  const options: { id: ThemeMode; label: string; icon: LucideIcon }[] = [
    { id: "system", label: t("settings.appearance.system"), icon: Laptop },
    { id: "light", label: t("settings.appearance.light"), icon: Sun },
    { id: "dark", label: t("settings.appearance.dark"), icon: Moon },
  ];

  return (
    <div>
      <PaneHeader title={t("settings.appearance.title")} description={t("settings.appearance.description")} />

      <Row label={t("settings.appearance.mode")} hint={t("settings.appearance.modeHint")}>
        <Segmented value={mode} options={options} onChange={setMode} />
      </Row>

      <div className="pt-[20px]">
        <ThemePicker />
      </div>
    </div>
  );
}

function InterfacePane() {
  const { t } = useTranslation();
  const enabledAgents = useSettingsDataStore((s) => s.settings.interface.enabledAgents);
  const iconStyle = useSettingsDataStore((s) => s.settings.interface.explorerIconStyle);
  const density = useSettingsDataStore((s) => s.settings.interface.uiDensity);
  const update = useSettingsDataStore((s) => s.update);

  // Stable order: coding agents first (same order as the registry), then autonomous.
  const ordered = [
    ...DEFAULT_CLI_REGISTRY.filter((c) => cliCategory(c) === "coding"),
    ...DEFAULT_CLI_REGISTRY.filter((c) => cliCategory(c) === "autonomous"),
  ];

  const setEnabled = (id: string, next: boolean) => {
    update("interface", { enabledAgents: { ...enabledAgents, [id]: next } });
  };

  const iconStyleOptions: { id: ExplorerIconStyle; label: string }[] = [
    { id: "mono", label: t("settings.interface.iconStyleMono") },
    { id: "color", label: t("settings.interface.iconStyleColor") },
  ];

  const densityOptions: { id: UiDensity; label: string }[] = [
    { id: "compact", label: t("settings.interface.densityCompact") },
    { id: "comfortable", label: t("settings.interface.densityComfortable") },
    { id: "spacious", label: t("settings.interface.densitySpacious") },
  ];

  return (
    <div>
      <PaneHeader
        title={t("settings.interface.title")}
        description={t("settings.interface.description")}
      />

      <Row
        label={t("settings.interface.density")}
        hint={t("settings.interface.densityHint")}
      >
        <Segmented
          value={density}
          options={densityOptions}
          onChange={(v) => update("interface", { uiDensity: v })}
        />
      </Row>

      <Row
        label={t("settings.interface.iconStyle")}
        hint={t("settings.interface.iconStyleHint")}
      >
        <Segmented
          value={iconStyle}
          options={iconStyleOptions}
          onChange={(v) => update("interface", { explorerIconStyle: v })}
        />
      </Row>

      <div className="mb-[8px] mt-[20px] flex items-center justify-between">
        <h3 className="editorial-caps text-muted">
          {t("settings.interface.launcherVisibilityTitle")}
        </h3>
      </div>
      <p className="mb-[10px] text-[12px] text-muted">
        {t("settings.interface.launcherVisibilityHint")}
      </p>

      <ul className="flex flex-col">
        {ordered.map((cli) => {
          const BrandIcon = CLI_BRAND_ICONS[cli.id];
          const enabled = isAgentEnabled(cli.id, enabledAgents);
          return (
            <li
              key={cli.id}
              className="flex items-center justify-between gap-[16px] border-b border-hairline-soft py-[12px] last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-[10px]">
                {BrandIcon ? (
                  <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center text-ink">
                    <BrandIcon size={16} />
                  </span>
                ) : null}
                <div className="min-w-0">
                  <div className="flex items-center gap-[8px]">
                    <span className="text-[13px] font-medium text-ink">{cli.label}</span>
                    {cliCategory(cli) === "autonomous" ? (
                      <Badge tone="muted">{t("settings.interface.autonomousTag")}</Badge>
                    ) : null}
                  </div>
                  <div className="mt-[2px] truncate font-mono text-[11px] text-muted">
                    {cli.command}
                  </div>
                </div>
              </div>
              <Switch
                checked={enabled}
                onChange={(v) => setEnabled(cli.id, v)}
                ariaLabel={t("settings.interface.toggleAria", { name: cli.label })}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Compact pill switch — visual style matches the rest of the settings dialog
 *  (no Radix dependency, no animation library; a plain accessible button). */
function Switch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]",
        checked
          ? "border-ink bg-ink"
          : "border-hairline-strong bg-surface-strong/40 hover:bg-surface-strong/60",
      )}
    >
      <span
        className={cn(
          "inline-block h-[12px] w-[12px] rounded-full transition-transform",
          checked ? "translate-x-[16px] bg-on-primary" : "translate-x-[2px] bg-muted",
        )}
      />
    </button>
  );
}

function EditorPane() {
  const { t } = useTranslation();
  const editor = useSettingsDataStore((s) => s.settings.editor);
  const update = useSettingsDataStore((s) => s.update);

  return (
    <div>
      <PaneHeader title={t("settings.editor.title")} description={t("settings.editor.description")} />

      <Row label={t("settings.editor.fontFamily")} hint={t("settings.editor.fontFamilyHint")}>
        <Select
          ariaLabel={t("settings.editor.fontFamily")}
          value={editor.fontFamily}
          options={withCurrent(EDITOR_FONT_OPTIONS, editor.fontFamily)}
          onValueChange={(v) => update("editor", { fontFamily: v })}
        />
      </Row>

      <Row label={t("settings.editor.fontSize")} hint={t("settings.editor.fontSizeHint")}>
        <NumberStepper
          ariaLabel={t("settings.editor.fontSize")}
          value={editor.fontSize}
          min={8}
          max={32}
          onChange={(v) => update("editor", { fontSize: v })}
        />
      </Row>

      <Row label={t("settings.editor.stickyScroll")} hint={t("settings.editor.stickyScrollHint")}>
        <NumberStepper
          ariaLabel={t("settings.editor.stickyScroll")}
          value={editor.stickyScrollMaxHeaders}
          min={0}
          max={20}
          onChange={(v) => update("editor", { stickyScrollMaxHeaders: v })}
        />
      </Row>
    </div>
  );
}

function TerminalPane() {
  const { t } = useTranslation();
  const terminal = useSettingsDataStore((s) => s.settings.terminal);
  const update = useSettingsDataStore((s) => s.update);

  const cursorOptions: { id: TerminalCursorStyle; label: string }[] = [
    { id: "bar", label: t("settings.terminal.cursorBar") },
    { id: "block", label: t("settings.terminal.cursorBlock") },
    { id: "underline", label: t("settings.terminal.cursorUnderline") },
  ];

  return (
    <div>
      <PaneHeader title={t("settings.terminal.title")} description={t("settings.terminal.description")} />

      <Row label={t("settings.terminal.fontFamily")} hint={t("settings.terminal.fontFamilyHint")}>
        <Select
          ariaLabel={t("settings.terminal.fontFamily")}
          value={terminal.fontFamily}
          options={withCurrent(TERMINAL_FONT_OPTIONS, terminal.fontFamily)}
          onValueChange={(v) => update("terminal", { fontFamily: v })}
        />
      </Row>

      <Row label={t("settings.terminal.fontSize")} hint={t("settings.terminal.fontSizeHint")}>
        <NumberStepper
          ariaLabel={t("settings.terminal.fontSize")}
          value={terminal.fontSize}
          min={8}
          max={32}
          onChange={(v) => update("terminal", { fontSize: v })}
        />
      </Row>

      <Row label={t("settings.terminal.cursorStyle")} hint={t("settings.terminal.cursorStyleHint")}>
        <Segmented
          value={terminal.cursorStyle}
          options={cursorOptions}
          onChange={(v) => update("terminal", { cursorStyle: v })}
        />
      </Row>

      <Row label={t("settings.terminal.scrollback")} hint={t("settings.terminal.scrollbackHint")}>
        <NumberStepper
          ariaLabel={t("settings.terminal.scrollback")}
          value={terminal.scrollback}
          min={0}
          max={500000}
          step={1000}
          onChange={(v) => update("terminal", { scrollback: v })}
        />
      </Row>
    </div>
  );
}

function NotificationsPane() {
  const { t } = useTranslation();
  const notifications = useSettingsDataStore((s) => s.settings.notifications);
  const update = useSettingsDataStore((s) => s.update);

  return (
    <div>
      <PaneHeader
        title={t("settings.notifications.title")}
        description={t("settings.notifications.description")}
      />

      <Row
        label={t("settings.notifications.osNotifications")}
        hint={t("settings.notifications.osNotificationsHint")}
      >
        <Switch
          checked={notifications.osNotificationsEnabled}
          onChange={(v) => update("notifications", { osNotificationsEnabled: v })}
          ariaLabel={t("settings.notifications.osNotifications")}
        />
      </Row>

      <Row
        label={t("settings.notifications.sound")}
        hint={t("settings.notifications.soundHint")}
      >
        <Switch
          checked={notifications.soundEnabled}
          onChange={(v) => update("notifications", { soundEnabled: v })}
          ariaLabel={t("settings.notifications.sound")}
        />
      </Row>

      <Row
        label={t("settings.notifications.notifyWhenFocused")}
        hint={t("settings.notifications.notifyWhenFocusedHint")}
      >
        <Switch
          checked={notifications.notifyWhenFocused}
          onChange={(v) => update("notifications", { notifyWhenFocused: v })}
          ariaLabel={t("settings.notifications.notifyWhenFocused")}
        />
      </Row>
    </div>
  );
}

function AdvancedPane() {
  const { t } = useTranslation();
  const perf = useSettingsDataStore((s) => s.settings.performance);
  const update = useSettingsDataStore((s) => s.update);

  return (
    <div>
      <PaneHeader title={t("settings.advanced.title")} description={t("settings.advanced.description")} />

      <Row label={t("settings.advanced.saveDebounce")} hint={t("settings.advanced.saveDebounceHint")}>
        <NumberStepper
          ariaLabel={t("settings.advanced.saveDebounce")}
          value={perf.workspaceSaveDebounceMs}
          min={0}
          max={5000}
          step={50}
          onChange={(v) => update("performance", { workspaceSaveDebounceMs: v })}
        />
      </Row>

      <Row label={t("settings.advanced.searchDebounce")} hint={t("settings.advanced.searchDebounceHint")}>
        <NumberStepper
          ariaLabel={t("settings.advanced.searchDebounce")}
          value={perf.searchDebounceMs}
          min={0}
          max={5000}
          step={50}
          onChange={(v) => update("performance", { searchDebounceMs: v })}
        />
      </Row>
    </div>
  );
}

function ShortcutsPane() {
  const { t } = useTranslation();
  const resetAll = useKeybindingsStore((s) => s.resetAll);

  return (
    <div>
      <div className="mb-[12px] flex items-start justify-between gap-[16px]">
        <PaneHeader title={t("settings.shortcuts.title")} description={t("settings.shortcuts.description")} />
        <button
          type="button"
          onClick={resetAll}
          className="mt-[4px] shrink-0 rounded-sm border border-hairline-strong px-[10px] py-[5px] text-[11px] text-body transition-colors hover:bg-surface-strong/45 hover:text-ink"
        >
          {t("settings.shortcuts.resetAll")}
        </button>
      </div>
      <ul className="flex flex-col">
        {COMMANDS.map((c) =>
          c.range ? (
            <RangeShortcutRow key={c.id} command={c} />
          ) : (
            <ShortcutRow key={c.id} command={c} />
          ),
        )}
      </ul>
    </div>
  );
}

function ShortcutRow({ command }: { command: CommandDef }) {
  const { t } = useTranslation();
  const bindings = useKeybindingsStore((s) => s.bindingsFor(command.id));
  const overridden = useKeybindingsStore((s) => command.id in s.overrides);
  const rebind = useKeybindingsStore((s) => s.rebind);
  const resetToDefault = useKeybindingsStore((s) => s.resetToDefault);
  const findConflict = useKeybindingsStore((s) => s.findConflict);
  const setCaptureActive = useKeybindingsStore((s) => s.setCaptureActive);

  const [capturing, setCapturing] = useState(false);
  const [conflict, setConflict] = useState<CommandId | null>(null);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    setCaptureActive(true);
    const stop = () => {
      setCapturing(false);
      setConflict(null);
      pendingRef.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return stop();
      if (isModifierOnly(e)) return; // wait for a real key
      const b = eventToBinding(e);
      if (!b.mod && !b.ctrl && !b.alt) return; // global shortcut needs a modifier
      const str = formatBinding(b);
      const owner = findConflict(str, command.id);
      if (owner && pendingRef.current !== str) {
        // First press of a conflicting combo: warn, arm for confirmation.
        setConflict(owner);
        pendingRef.current = str;
        return;
      }
      // No conflict, or the user pressed the same combo again → reassign.
      rebind(command.id, str);
      stop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setCaptureActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  return (
    <li className="flex items-center justify-between gap-[16px] border-b border-hairline-soft py-[12px] last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink">{t(command.descriptionKey)}</div>
        {conflict ? (
          <div className="mt-[3px] text-[11px] text-warn">
            {t("settings.shortcuts.conflictWith", {
              command: t(COMMANDS_BY_ID[conflict].descriptionKey),
            })}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-[8px]">
        {overridden && !capturing ? (
          <button
            type="button"
            onClick={() => resetToDefault(command.id)}
            aria-label={t("settings.shortcuts.reset")}
            title={t("settings.shortcuts.reset")}
            className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-xs text-muted outline-none transition-colors hover:bg-surface-strong/55 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/25"
          >
            <Icon icon={RotateCcw} size={12} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setCapturing((c) => !c)}
          className={cn(
            "inline-flex h-[26px] min-w-[96px] items-center justify-center rounded-sm border px-[8px] text-[11px] outline-none transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ink/25",
            capturing
              ? "border-ink bg-surface-strong/40"
              : "border-hairline-strong hover:bg-surface-strong/45",
            conflict ? "border-warn" : "",
          )}
        >
          {capturing ? (
            <span className="text-muted">{t("settings.shortcuts.capturePrompt")}</span>
          ) : bindings.length > 0 && bindings[0] ? (
            <Kbd keys={bindingToKbdTokens(bindings[0])} />
          ) : (
            <span className="text-muted-soft">{t("settings.shortcuts.unbound")}</span>
          )}
        </button>
      </div>
    </li>
  );
}

function RangeShortcutRow({ command }: { command: CommandDef }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center justify-between gap-[16px] border-b border-hairline-soft py-[12px] last:border-b-0">
      <span className="text-[13px] text-ink">{t(command.descriptionKey)}</span>
      <span className="inline-flex items-center gap-[5px]">
        <Kbd keys={["Mod", "1"]} />
        <span className="text-[11px] text-muted-soft">…</span>
        <Kbd keys={["Mod", "9"]} />
      </span>
    </li>
  );
}

function AgentPane() {
  const { t } = useTranslation();
  const status = useAgentRuntimeStore((s) => s.status);
  const providers = useAgentRuntimeStore((s) => s.providers);
  const starting = useAgentRuntimeStore((s) => s.starting);
  const loadingModels = useAgentRuntimeStore((s) => s.loadingModels);
  const runtimeError = useAgentRuntimeStore((s) => s.error);
  const start = useAgentRuntimeStore((s) => s.start);
  const loadModels = useAgentRuntimeStore((s) => s.loadModels);
  const setCredentials = useAgentRuntimeStore((s) => s.setCredentials);

  const agent = useSettingsDataStore((s) => s.settings.agent);
  const update = useSettingsDataStore((s) => s.update);

  const [key, setKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  // Spin up the runtime + load the model catalog when this pane opens.
  useEffect(() => {
    void (async () => {
      await start();
      await loadModels();
    })();
  }, [start, loadModels]);

  const provider = providers.find((p) => p.id === agent.providerId) ?? providers[0] ?? null;
  const modelOptions: SelectOption[] = (provider?.models ?? []).map((m) => ({
    value: m.id,
    label: m.name,
  }));
  const selectedModel = agent.modelId || provider?.defaultModel || "";

  const saveKey = async () => {
    if (!key) return;
    setSavingKey(true);
    try {
      await setCredentials(agent.providerId || "opencode-go", key);
      setKey("");
      await loadModels();
    } finally {
      setSavingKey(false);
    }
  };

  return (
    <div>
      <PaneHeader title={t("agent.settings.title")} description={t("agent.settings.description")} />

      <Row
        label={t("agent.settings.runtime")}
        hint={
          status.running
            ? t("agent.settings.runtimeHealthy", { version: status.version ?? "" })
            : starting
              ? t("agent.settings.runtimeStarting")
              : t("agent.settings.runtimeStopped")
        }
      >
        <div className="flex items-center gap-[8px]">
          <span
            className={cn(
              "inline-block h-[8px] w-[8px] rounded-full",
              status.running ? "bg-success" : "bg-muted-soft",
            )}
          />
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting}
            className="inline-flex h-[30px] items-center gap-[6px] rounded-sm border border-hairline-strong px-[10px] text-[12px] text-ink hover:bg-surface-strong/45 disabled:opacity-50"
          >
            <Icon
              icon={starting ? Loader2 : RefreshCw}
              size={13}
              className={starting ? "animate-spin" : ""}
            />
            {t("agent.settings.restart")}
          </button>
        </div>
      </Row>

      <OpencodeCliRow />

      <Row
        label={t("agent.settings.apiKey")}
        hint={
          providers.length > 0
            ? t("agent.settings.apiKeyDetectedHint")
            : t("agent.settings.apiKeyHint")
        }
      >
        <div className="flex items-center gap-[6px]">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
            className="h-[30px] w-[200px] rounded-sm border border-hairline-strong bg-surface-card px-[8px] text-[12px] text-ink outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={() => void saveKey()}
            disabled={!key || savingKey}
            className="inline-flex h-[30px] items-center rounded-sm border border-ink bg-ink px-[12px] text-[12px] text-on-primary disabled:opacity-50"
          >
            {t("agent.settings.save")}
          </button>
        </div>
      </Row>

      <Row label={t("agent.settings.defaultModel")} hint={t("agent.settings.defaultModelHint")}>
        {modelOptions.length > 0 ? (
          <Select
            value={selectedModel}
            options={modelOptions}
            ariaLabel={t("agent.settings.defaultModel")}
            onValueChange={(v) =>
              update("agent", { providerId: provider?.id ?? "opencode-go", modelId: v })
            }
          />
        ) : (
          <span className="text-[12px] text-muted">
            {loadingModels ? t("agent.settings.loadingModels") : t("agent.settings.noModels")}
          </span>
        )}
      </Row>

      <Row label={t("agent.settings.visionModel")} hint={t("agent.settings.visionModelHint")}>
        <VisionModelSelect />
      </Row>

      {runtimeError ? <p className="mt-[12px] text-[12px] text-danger">{runtimeError}</p> : null}
    </div>
  );
}

/** Where the opencode binary comes from: auto-detected on the login-shell
 *  PATH (same probe the CLI Registry uses). Surfaces the detection so the
 *  user knows nothing needs configuring — or exactly what to install. */
function OpencodeCliRow() {
  const { t } = useTranslation();
  const detections = useCliDetections();
  const cli = DEFAULT_CLI_REGISTRY.find((c) => c.id === "opencode")!;
  const det = cliDetectionFor(cli, detections);

  const hint =
    det.status === "installed"
      ? (det.path ?? t("agent.settings.cliDetectedNoPath"))
      : det.status === "missing"
        ? t("agent.settings.cliMissing", { command: cli.installCommand })
        : t("agent.settings.cliChecking");

  return (
    <Row label={t("agent.settings.cliBinary")} hint={hint}>
      <span className="inline-flex h-[30px] items-center gap-[7px] text-[12px] text-muted">
        {det.status === "checking" ? (
          <Icon icon={Loader2} size={12} className="animate-spin" />
        ) : (
          <span
            className={cn(
              "inline-block h-[8px] w-[8px] rounded-full",
              det.status === "installed" ? "bg-success" : "bg-danger",
            )}
          />
        )}
        {det.status === "installed"
          ? t("agent.settings.cliAutoDetected")
          : det.status === "missing"
            ? t("agent.settings.cliNotFound")
            : null}
      </span>
    </Row>
  );
}

/** Vision-relay model: every catalog model that can see images, across
 *  providers, stored as `visionProviderId` + `visionModelId`. */
function VisionModelSelect() {
  const { t } = useTranslation();
  const providers = useAgentRuntimeStore((s) => s.providers);
  const agent = useSettingsDataStore((s) => s.settings.agent);
  const update = useSettingsDataStore((s) => s.update);

  const options: SelectOption[] = providers.flatMap((p) =>
    p.models
      .filter((m) => m.attachment)
      .map((m) => ({ value: modelKey(p.id, m.id), label: `${m.name} (${p.name})` })),
  );
  if (options.length === 0) {
    return <span className="text-[12px] text-muted">{t("agent.settings.noModels")}</span>;
  }
  const current = modelKey(agent.visionProviderId, agent.visionModelId);
  return (
    <Select
      value={current}
      options={withCurrent(options, current)}
      ariaLabel={t("agent.settings.visionModel")}
      onValueChange={(v) => {
        const slash = v.indexOf("/");
        if (slash === -1) return;
        update("agent", {
          visionProviderId: v.slice(0, slash),
          visionModelId: v.slice(slash + 1),
        });
      }}
    />
  );
}

/** Which catalog models the composer's picker offers. Default rule: only the
 *  opencode-go provider; explicit toggles override per model. */
function AgentModelsPane() {
  const { t } = useTranslation();
  const providers = useAgentRuntimeStore((s) => s.providers);
  const loadingModels = useAgentRuntimeStore((s) => s.loadingModels);
  const loadModels = useAgentRuntimeStore((s) => s.loadModels);
  const start = useAgentRuntimeStore((s) => s.start);
  const enabledModels = useSettingsDataStore((s) => s.settings.agent.enabledModels);
  const update = useSettingsDataStore((s) => s.update);

  useEffect(() => {
    void (async () => {
      await start();
      await loadModels();
    })();
  }, [start, loadModels]);

  const setEnabled = (providerId: string, modelId: string, enabled: boolean) => {
    update("agent", {
      enabledModels: { ...enabledModels, [modelKey(providerId, modelId)]: enabled },
    });
  };

  const setProvider = (providerId: string, enabled: boolean) => {
    const next = { ...enabledModels };
    for (const p of providers) {
      if (p.id !== providerId) continue;
      for (const m of p.models) next[modelKey(p.id, m.id)] = enabled;
    }
    update("agent", { enabledModels: next });
  };

  return (
    <div>
      <PaneHeader
        title={t("agent.settings.modelsTitle")}
        description={t("agent.settings.modelsDescription")}
      />
      {providers.length === 0 ? (
        <span className="text-[12px] text-muted">
          {loadingModels ? t("agent.settings.loadingModels") : t("agent.settings.noModels")}
        </span>
      ) : (
        providers.map((p) => {
          const allOn = p.models.every((m) => isModelEnabled(enabledModels, p.id, m.id));
          return (
            <section key={p.id} className="mb-[18px]">
              <div className="mb-[4px] flex items-center justify-between">
                <h3 className="editorial-caps">{p.name}</h3>
                <button
                  type="button"
                  onClick={() => setProvider(p.id, !allOn)}
                  className="text-[11px] text-muted hover:text-ink"
                >
                  {allOn ? t("agent.settings.disableAll") : t("agent.settings.enableAll")}
                </button>
              </div>
              {p.models.map((m) => (
                <Row
                  key={m.id}
                  label={m.name}
                  hint={[
                    m.attachment ? t("agent.settings.capVision") : null,
                    m.reasoning ? t("agent.settings.capReasoning") : null,
                    m.variants.length > 0 ? t("agent.settings.capVariants") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  <Switch
                    checked={isModelEnabled(enabledModels, p.id, m.id)}
                    onChange={(next) => setEnabled(p.id, m.id, next)}
                    ariaLabel={t("agent.settings.toggleModelAria", { name: m.name })}
                  />
                </Row>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function CliRegistryPane() {
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
                  <span className="text-[13px] font-medium text-ink">{cli.label}</span>
                  <CliStatusBadge status={detection.status} />
                  {cli.dangerLevel === "dangerous" && <Badge tone="warn">{t("cli.dangerous")}</Badge>}
                  {cli.needsConfig && detection.status !== "installed" ? (
                    <Badge tone="muted">{t("cli.needsConfig")}</Badge>
                  ) : null}
                </div>
                <div className="mt-[2px] font-mono text-[11px] text-muted">
                  {t("settings.cli.command")}: {cli.command}
                </div>
                {detection.path ? (
                  <div
                    className="mt-[2px] truncate font-mono text-[11px] text-muted-soft"
                    title={detection.path}
                  >
                    {t("settings.cli.detectedPath")}: {detection.path}
                  </div>
                ) : cli.installCommand ? (
                  <div
                    className="mt-[2px] truncate font-mono text-[11px] text-muted-soft"
                    title={cli.installCommand}
                  >
                    {t("settings.cli.install")}: {cli.installCommand}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-[16px] rounded-sm border border-hairline-soft bg-canvas-soft px-[12px] py-[10px] text-[12px] text-muted">
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
        <Icon icon={Loader2} size={10} className="animate-spin" />
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

function AboutPane() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<"up-to-date" | "dev" | null>(null);
  const updateStatus = useUpdatesStore((s) => s.status);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isChecking = updateStatus.kind === "checking";
  const isAvailable = updateStatus.kind === "available";
  const isBusy =
    updateStatus.kind === "downloading" || updateStatus.kind === "installing";
  const isError = updateStatus.kind === "error";

  const handleCheck = async () => {
    setLastResult(null);
    const result = await checkForUpdatesManual();
    if (result.kind === "up-to-date") setLastResult("up-to-date");
    else if (result.kind === "dev") setLastResult("dev");
  };

  const handleInstall = () => {
    void startInstall();
  };

  const openAuthorSite = () => {
    invoke(CMD.openExternalUrl, {
      url: "https://www.victorbenazzi.com.br/?utm_source=metacodex&utm_medium=app&utm_campaign=about",
    }).catch((err) => console.warn("[open_external_url] failed", err));
  };

  return (
    <div>
      <PaneHeader title={t("settings.about.title")} />
      <h1
        className="font-display text-[40px] font-medium tracking-[-0.015em] text-ink"
        style={{ lineHeight: 1.05 }}
      >
        metacodex
      </h1>
      <p className="mt-[10px] font-display text-[16px] leading-[1.5] text-body">
        {t("settings.about.tagline")}
      </p>
      <ul className="mt-[20px] flex flex-col gap-[6px]">
        <li className="font-mono text-[11px] text-muted">
          {t("settings.about.version")}{" "}
          <span className="text-ink">{version ?? "…"}</span>
        </li>
        <li className="font-mono text-[11px] text-muted">
          {t("settings.about.platform")} <span className="text-ink">macOS · Apple Silicon</span>
        </li>
        <li className="font-mono text-[11px] text-muted">
          {t("settings.about.stack")}{" "}
          <span className="text-ink">
            Tauri 2 · React 19 · CodeMirror 6 · xterm.js · portable-pty
          </span>
        </li>
      </ul>

      <div className="mt-[18px] flex flex-wrap items-center gap-[10px]">
        {isAvailable ? (
          <button
            type="button"
            onClick={handleInstall}
            className="inline-flex items-center gap-[6px] rounded-sm border border-[var(--update-blue-strong)] bg-[var(--update-blue-strong)] px-[10px] py-[5px] font-mono text-[11px] leading-none text-white transition duration-150 hover:brightness-110"
            title={t("updates.pill.available", { version: updateStatus.version })}
          >
            <Icon icon={Download} size={10} strokeWidth={2} />
            <span>{t("updates.pill.available", { version: updateStatus.version })}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCheck}
            disabled={isChecking || isBusy}
            className="inline-flex items-center gap-[6px] rounded-sm border border-hairline-strong px-[10px] py-[5px] font-mono text-[11px] leading-none text-ink transition-colors duration-150 hover:bg-surface-strong/45 disabled:cursor-default disabled:opacity-50"
          >
            <Icon
              icon={isChecking ? Loader2 : RefreshCw}
              size={10}
              strokeWidth={2}
              className={isChecking ? "animate-spin" : undefined}
            />
            <span>
              {isChecking
                ? t("settings.about.checking")
                : t("settings.about.checkForUpdates")}
            </span>
          </button>
        )}

        {!isChecking && !isAvailable && lastResult === "up-to-date" && (
          <span className="inline-flex items-center gap-[4px] font-mono text-[11px] text-success">
            <Icon icon={CheckCircle2} size={10} strokeWidth={2} />
            {t("settings.about.upToDate")}
          </span>
        )}
        {!isChecking && lastResult === "dev" && (
          <span className="font-mono text-[11px] text-muted">
            {t("settings.about.devNoUpdates")}
          </span>
        )}
        {!isChecking && !isAvailable && isError && (
          <span
            className="inline-flex items-center gap-[4px] font-mono text-[11px] text-warn"
            title={updateStatus.message}
          >
            <Icon icon={CircleAlert} size={10} strokeWidth={2} />
            {t("settings.about.checkFailed")}
          </span>
        )}
      </div>

      <p className="mt-[18px] font-mono text-[11px] text-muted">
        {t("settings.about.author")}{" "}
        <button
          type="button"
          onClick={openAuthorSite}
          title="victorbenazzi.com.br"
          className="group inline-flex items-center gap-[3px] rounded-xs text-ink transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]"
        >
          <span className="underline decoration-1 decoration-hairline underline-offset-[3px] transition-colors duration-150 group-hover:decoration-muted">
            Victor Benazzi
          </span>
          <Icon
            icon={ArrowUpRight}
            size={10}
            className="opacity-60 transition-transform duration-150 group-hover:-translate-y-px group-hover:translate-x-px"
          />
        </button>
      </p>
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warn" | "muted" | "success";
}) {
  const cls =
    tone === "warn"
      ? "border-warn/40 text-warn bg-warn/[0.06]"
      : tone === "success"
        ? "border-success/35 text-success bg-success/[0.06]"
      : tone === "muted"
        ? "border-hairline text-muted"
        : "border-hairline-strong text-ink";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[4px] rounded-xs border px-[6px] py-[1px] font-mono text-[10px] uppercase tracking-[0.08em]",
        cls,
      )}
    >
      {children}
    </span>
  );
}
