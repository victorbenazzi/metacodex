import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Kbd } from "@/components/ui/Kbd";
import { PaneHeader } from "@/components/settings/SettingsPrimitives";
import { cn } from "@/lib/cn";
import { COMMANDS, COMMANDS_BY_ID } from "@/features/keybindings/commands";
import { useKeybindingsStore } from "@/features/keybindings/keybindings.store";
import {
  bindingToKbdTokens,
  eventToBinding,
  formatBinding,
  isModifierOnly,
} from "@/features/keybindings/binding";
import type { CommandDef, CommandId } from "@/features/keybindings/types";

export function ShortcutsPane() {
  const { t } = useTranslation();
  const resetAll = useKeybindingsStore((s) => s.resetAll);

  return (
    <div>
      <div className="mb-[12px] flex items-start justify-between gap-[16px]">
        <PaneHeader title={t("settings.shortcuts.title")} description={t("settings.shortcuts.description")} />
        <button
          type="button"
          onClick={resetAll}
          className="mt-[4px] shrink-0 rounded-sm border border-hairline-strong px-[10px] py-[5px] text-label text-body transition-colors hover:bg-surface-strong/45 hover:text-ink"
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
        <div className="text-ui text-ink">{t(command.descriptionKey)}</div>
        {conflict ? (
          <div className="mt-[3px] text-label text-warn">
            {t("settings.shortcuts.conflictWith", {
              command: t(COMMANDS_BY_ID[conflict].descriptionKey),
            })}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-[8px]">
        {overridden && !capturing ? (
          <IconButton
            onClick={() => resetToDefault(command.id)}
            aria-label={t("settings.shortcuts.reset")}
            title={t("settings.shortcuts.reset")}
          >
            <Icon icon={RotateCcw} size={12} />
          </IconButton>
        ) : null}
        <button
          type="button"
          onClick={() => setCapturing((c) => !c)}
          className={cn(
            "inline-flex h-[26px] min-w-[96px] items-center justify-center rounded-sm border px-[8px] text-label outline-none transition-colors",
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
      <span className="text-ui text-ink">{t(command.descriptionKey)}</span>
      <span className="inline-flex items-center gap-[5px]">
        <Kbd keys={["Mod", "1"]} />
        <span className="text-label text-muted-soft">…</span>
        <Kbd keys={["Mod", "9"]} />
      </span>
    </li>
  );
}
