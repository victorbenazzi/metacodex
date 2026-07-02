import { useTranslation } from "react-i18next";

import { NumberStepper } from "@/components/ui/NumberStepper";
import { Segmented } from "@/components/ui/Segmented";
import { Select, type SelectOption } from "@/components/ui/Select";
import { PaneHeader, Row, withCurrent } from "@/components/settings/SettingsPrimitives";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  type TerminalCursorStyle,
} from "@/features/settings/settings.types";

const TERMINAL_FONT_OPTIONS: SelectOption[] = [
  { value: DEFAULT_TERMINAL_FONT_FAMILY, label: "JetBrains Mono Nerd Font" },
  { value: '"SF Mono", ui-monospace, monospace', label: "SF Mono" },
  { value: "Menlo, monospace", label: "Menlo" },
  { value: "Monaco, monospace", label: "Monaco" },
  { value: '"Hack Nerd Font Mono", monospace', label: "Hack Nerd Font" },
  { value: '"FiraCode Nerd Font Mono", monospace', label: "Fira Code Nerd Font" },
];

export function TerminalPane() {
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
