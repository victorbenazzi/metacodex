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
  X,
  Sun,
  Moon,
  Laptop,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { Kbd } from "@/components/ui/Kbd";
import { Select, type SelectOption } from "@/components/ui/Select";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { cn } from "@/lib/cn";
import { CMD, invoke } from "@/lib/ipc";
import { useThemeStore, type ThemeMode } from "@/features/theme/theme.store";
import { SUPPORTED_LANGUAGES } from "@/features/i18n/config";
import { DEFAULT_CLI_REGISTRY } from "@/features/terminal/cli-registry";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  type TerminalCursorStyle,
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

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CategoryId =
  | "general"
  | "appearance"
  | "editor"
  | "terminal"
  | "shortcuts"
  | "advanced"
  | "cli"
  | "about";

interface Category {
  id: CategoryId;
  labelKey: string;
  icon: LucideIcon;
}

const CATEGORIES: Category[] = [
  { id: "general", labelKey: "settings.nav.general", icon: Sliders },
  { id: "appearance", labelKey: "settings.nav.appearance", icon: Palette },
  { id: "editor", labelKey: "settings.nav.editor", icon: FileCode },
  { id: "terminal", labelKey: "settings.nav.terminal", icon: SquareTerminal },
  { id: "shortcuts", labelKey: "settings.nav.shortcuts", icon: Keyboard },
  { id: "advanced", labelKey: "settings.nav.advanced", icon: Gauge },
  { id: "cli", labelKey: "settings.nav.cli", icon: Terminal },
  { id: "about", labelKey: "settings.nav.about", icon: Info },
];

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
  const [selected, setSelected] = useState<CategoryId>("general");

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay
          className={cn(
            "fixed inset-0 z-[100] bg-[rgba(38,37,30,0.32)]",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        <RD.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2",
            "h-[520px] w-[760px] overflow-hidden rounded-lg border border-hairline bg-surface-card",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
          aria-describedby={undefined}
        >
          <RD.Title className="sr-only">metacodex settings</RD.Title>

          <header className="relative flex h-[44px] items-center justify-between border-b border-hairline-soft px-[16px]">
            <div className="flex items-center gap-[10px]">
              <span className="editorial-caps">{t("settings.header")}</span>
              <span className="font-mono text-[11px] text-muted-soft">metacodex</span>
            </div>
            <RD.Close asChild>
              <button
                type="button"
                aria-label={t("settings.close")}
                className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-xs text-muted hover:bg-surface-strong/55 hover:text-ink"
              >
                <Icon icon={X} size={13} />
              </button>
            </RD.Close>
          </header>

          <div className="grid h-[calc(100%-44px)] grid-cols-[220px_1fr]">
            <aside className="flex flex-col gap-[1px] overflow-y-auto border-r border-hairline-soft bg-canvas-soft p-[8px]">
              {CATEGORIES.map((c) => (
                <SidebarRow
                  key={c.id}
                  category={c}
                  active={selected === c.id}
                  onClick={() => setSelected(c.id)}
                />
              ))}
            </aside>

            <section className="overflow-y-auto px-[24px] py-[20px]">
              {selected === "general" && <GeneralPane />}
              {selected === "appearance" && <AppearancePane />}
              {selected === "editor" && <EditorPane />}
              {selected === "terminal" && <TerminalPane />}
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

      <Row label={t("settings.appearance.theme")} hint={t("settings.appearance.themeHint")}>
        <Segmented value={mode} options={options} onChange={setMode} />
      </Row>

      <Row label={t("settings.appearance.baseSize")} hint={t("settings.appearance.baseSizeHint")}>
        <span className="font-mono text-[11px] text-muted">14px</span>
      </Row>

      <Row label={t("settings.appearance.displayFont")} hint={t("settings.appearance.displayFontHint")}>
        <span className="font-display text-[14px] italic text-muted">Fraunces</span>
      </Row>
    </div>
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

function CliRegistryPane() {
  const { t } = useTranslation();
  return (
    <div>
      <PaneHeader title={t("settings.cli.title")} description={t("settings.cli.description")} />
      <ul className="flex flex-col">
        {DEFAULT_CLI_REGISTRY.map((cli) => (
          <li
            key={cli.id}
            className="flex items-start justify-between gap-[16px] border-b border-hairline-soft py-[12px] last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-[8px]">
                <span className="text-[13px] font-medium text-ink">{cli.label}</span>
                {cli.dangerLevel === "dangerous" && <Badge tone="warn">{t("cli.dangerous")}</Badge>}
                {cli.needsConfig && <Badge tone="muted">{t("cli.needsConfig")}</Badge>}
              </div>
              <div className="mt-[2px] font-mono text-[11px] text-muted">
                {t("settings.cli.command")}: {cli.command}
              </div>
              {cli.installCommand ? (
                <div
                  className="mt-[2px] truncate font-mono text-[11px] text-muted-soft"
                  title={cli.installCommand}
                >
                  {t("settings.cli.install")}: {cli.installCommand}
                </div>
              ) : null}
            </div>
          </li>
        ))}
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

function AboutPane() {
  const { t } = useTranslation();
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
      <p className="mt-[10px] font-display text-[16px] italic leading-[1.5] text-body">
        {t("settings.about.tagline")}
      </p>
      <ul className="mt-[20px] flex flex-col gap-[6px]">
        <li className="font-mono text-[11px] text-muted">
          {t("settings.about.version")} <span className="text-ink">0.0.1</span>
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
      <p className="mt-[18px] font-mono text-[11px] text-muted">
        {t("settings.about.author")}{" "}
        <button
          type="button"
          onClick={openAuthorSite}
          title="victorbenazzi.com.br"
          className="group inline-flex items-center gap-[3px] rounded-[3px] text-ink transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-[2px]"
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
  tone?: "neutral" | "warn" | "muted";
}) {
  const cls =
    tone === "warn"
      ? "border-warn/40 text-warn bg-warn/[0.06]"
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
