import { useState, type ReactNode } from "react";
import * as RD from "@radix-ui/react-dialog";
import {
  Sliders,
  Palette,
  Keyboard,
  Terminal,
  Info,
  X,
  Sun,
  Moon,
  Laptop,
  type LucideIcon,
} from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useThemeStore, type ThemeMode } from "@/features/theme/theme.store";
import { DEFAULT_CLI_REGISTRY } from "@/features/terminal/cli-registry";
import { isMac } from "@/lib/platform";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CategoryId = "general" | "appearance" | "shortcuts" | "cli" | "about";

interface Category {
  id: CategoryId;
  label: string;
  icon: LucideIcon;
}

const CATEGORIES: Category[] = [
  { id: "general", label: "General", icon: Sliders },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "cli", label: "CLI Registry", icon: Terminal },
  { id: "about", label: "About", icon: Info },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [selected, setSelected] = useState<CategoryId>("general");

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay
          className={cn(
            "fixed inset-0 z-[100] bg-[rgba(38,37,30,0.32)] backdrop-blur-[3px]",
            "data-[state=open]:animate-fade-in",
          )}
        />
        <RD.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2",
            "h-[520px] w-[760px] overflow-hidden rounded-lg border border-hairline bg-surface-card",
            "data-[state=open]:animate-slide-up",
          )}
          aria-describedby={undefined}
        >
          <RD.Title className="sr-only">metacodex settings</RD.Title>

          {/* Header strip — drag-region for the modal would be nice but Tauri
              doesn't drag modals. We keep this lightweight: a title + close. */}
          <header className="relative flex h-[44px] items-center justify-between border-b border-hairline-soft px-[16px]">
            <div className="flex items-center gap-[10px]">
              <span className="editorial-caps">Settings</span>
              <span className="font-mono text-[11px] text-muted-soft">metacodex</span>
            </div>
            <RD.Close asChild>
              <button
                type="button"
                aria-label="Close settings"
                className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-xs text-muted hover:bg-surface-strong/55 hover:text-ink"
              >
                <Icon icon={X} size={13} />
              </button>
            </RD.Close>
          </header>

          <div className="grid h-[calc(100%-44px)] grid-cols-[220px_1fr]">
            {/* Sidebar */}
            <aside className="flex flex-col gap-[1px] border-r border-hairline-soft bg-canvas-soft p-[8px]">
              {CATEGORIES.map((c) => (
                <SidebarRow
                  key={c.id}
                  category={c}
                  active={selected === c.id}
                  onClick={() => setSelected(c.id)}
                />
              ))}
            </aside>

            {/* Right pane */}
            <section className="overflow-y-auto px-[24px] py-[20px]">
              {selected === "general" && <GeneralPane />}
              {selected === "appearance" && <AppearancePane />}
              {selected === "shortcuts" && <ShortcutsPane />}
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
      <Icon
        icon={category.icon}
        size={13}
        className={active ? "text-ink" : "text-muted"}
      />
      <span className="text-[13px] font-medium">{category.label}</span>
    </button>
  );
}

function PaneHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-[20px]">
      <h2 className="font-display text-[22px] font-medium tracking-[-0.005em] text-ink">
        {title}
      </h2>
      {description ? (
        <p className="mt-[4px] text-[13px] text-muted">{description}</p>
      ) : null}
    </header>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-[20px] border-b border-hairline-soft py-[14px] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {hint ? <div className="mt-[2px] text-[12px] text-muted">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function GeneralPane() {
  return (
    <div>
      <PaneHeader title="General" description="Workspace-level preferences." />

      <Row
        label="Project storage"
        hint="metacodex never modifies your folders on disk."
      >
        <span className="font-mono text-[11px] text-muted">
          ~/Library/Application Support/com.metacodex.app
        </span>
      </Row>

      <Row label="Save workspace state" hint="Open tabs and expanded folders restore on relaunch.">
        <Badge>Always on</Badge>
      </Row>

      <Row label="Restore terminals" hint="Terminal sessions are never auto-respawned on relaunch — by design.">
        <Badge>Off</Badge>
      </Row>
    </div>
  );
}

function AppearancePane() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  const options: { id: ThemeMode; label: string; icon: LucideIcon }[] = [
    { id: "system", label: "System", icon: Laptop },
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
  ];

  return (
    <div>
      <PaneHeader title="Appearance" description="Theme and visual settings." />

      <Row label="Theme" hint="Follows your operating system unless overridden.">
        <div className="flex gap-[6px]">
          {options.map((opt) => {
            const active = mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMode(opt.id)}
                className={cn(
                  "inline-flex h-[30px] items-center gap-[6px] rounded-sm border px-[10px] text-[12px] transition-colors",
                  active
                    ? "border-ink bg-ink text-on-primary"
                    : "border-hairline-strong text-ink hover:bg-surface-strong/45",
                )}
              >
                <Icon icon={opt.icon} size={12} className={active ? "text-on-primary" : ""} />
                {opt.label}
              </button>
            );
          })}
        </div>
      </Row>

      <Row label="Base UI size" hint="Set by spec — kept compact at 14px.">
        <span className="font-mono text-[11px] text-muted">14px</span>
      </Row>

      <Row label="Mono font" hint="Used for terminal, editor, and labels.">
        <span className="font-mono text-[11px] text-muted">JetBrains Mono</span>
      </Row>

      <Row label="Display font" hint="Used on welcome and section headings.">
        <span className="font-display text-[14px] italic text-muted">Fraunces</span>
      </Row>
    </div>
  );
}

function ShortcutsPane() {
  const mod = isMac ? "⌘" : "Ctrl";

  const items = [
    { keys: [mod, "O"], label: "Open folder" },
    { keys: [mod, "T"], label: "New terminal" },
    { keys: [mod, "S"], label: "Save active file" },
    { keys: [mod, "W"], label: "Close active tab" },
    { keys: [mod, "1..9"], label: "Switch project" },
    { keys: [mod, "Shift", "F"], label: "Search in project" },
    { keys: [mod, ","], label: "Open settings" },
  ];

  return (
    <div>
      <PaneHeader title="Shortcuts" description="Keyboard shortcuts available throughout metacodex." />
      <ul className="flex flex-col">
        {items.map((item) => (
          <li
            key={item.label}
            className="flex items-center justify-between border-b border-hairline-soft py-[12px] last:border-b-0"
          >
            <span className="text-[13px] text-ink">{item.label}</span>
            <span className="inline-flex items-center gap-[3px]">
              {item.keys.map((k) => (
                <kbd
                  key={k}
                  className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-xs border border-hairline bg-canvas-soft px-[6px] font-mono text-[11px] text-muted"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CliRegistryPane() {
  return (
    <div>
      <PaneHeader title="CLI Registry" description="AI coding CLIs available from the + menu." />
      <ul className="flex flex-col">
        {DEFAULT_CLI_REGISTRY.map((cli) => (
          <li
            key={cli.id}
            className="flex items-start justify-between gap-[16px] border-b border-hairline-soft py-[12px] last:border-b-0"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-[8px]">
                <span className="text-[13px] font-medium text-ink">{cli.label}</span>
                {cli.dangerLevel === "dangerous" && <Badge tone="warn">dangerous</Badge>}
                {cli.needsConfig && <Badge tone="muted">needs config</Badge>}
              </div>
              <div className="mt-[2px] font-mono text-[11px] text-muted">
                command: {cli.command}
              </div>
              {cli.installCommand ? (
                <div className="mt-[2px] font-mono text-[11px] text-muted-soft truncate" title={cli.installCommand}>
                  install: {cli.installCommand}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-[16px] rounded-sm border border-hairline-soft bg-canvas-soft px-[12px] py-[10px] text-[12px] text-muted">
        Custom CLI overrides will land in a future release. For now, edit{" "}
        <span className="font-mono text-ink">metacodex.store.json</span> and restart.
      </p>
    </div>
  );
}

function AboutPane() {
  return (
    <div>
      <PaneHeader title="About" />
      <h1
        className="font-display text-[40px] font-medium tracking-[-0.015em] text-ink"
        style={{ lineHeight: 1.05 }}
      >
        metacodex
      </h1>
      <p className="mt-[10px] font-display text-[16px] italic leading-[1.5] text-body">
        A quiet, local-first workspace for code &mdash; with a real native terminal and your favourite AI
        coding CLIs one keystroke away.
      </p>
      <ul className="mt-[20px] flex flex-col gap-[6px]">
        <li className="font-mono text-[11px] text-muted">
          version <span className="text-ink">0.0.1</span>
        </li>
        <li className="font-mono text-[11px] text-muted">
          platform <span className="text-ink">macOS · Apple Silicon</span>
        </li>
        <li className="font-mono text-[11px] text-muted">
          stack <span className="text-ink">Tauri 2 · React 19 · CodeMirror 6 · xterm.js · portable-pty</span>
        </li>
      </ul>
    </div>
  );
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "muted" }) {
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
