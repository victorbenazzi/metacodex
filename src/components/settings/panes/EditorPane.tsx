import { useTranslation } from "react-i18next";

import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select, type SelectOption } from "@/components/ui/Select";
import { PaneHeader, Row, withCurrent } from "@/components/settings/SettingsPrimitives";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";

/** Curated monospace families. Stored value is the CSS font stack. */
const EDITOR_FONT_OPTIONS: SelectOption[] = [
  { value: "var(--font-mono)", label: "JetBrains Mono" },
  { value: '"SF Mono", ui-monospace, monospace', label: "SF Mono" },
  { value: "Menlo, monospace", label: "Menlo" },
  { value: "Monaco, monospace", label: "Monaco" },
  { value: '"Fira Code", monospace', label: "Fira Code" },
  { value: '"Cascadia Code", monospace', label: "Cascadia Code" },
];

export function EditorPane() {
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
