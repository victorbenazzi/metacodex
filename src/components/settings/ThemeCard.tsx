import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";
import type { Theme } from "@/features/theme/types";

interface ThemeCardProps {
  theme: Theme;
  selected: boolean;
  onSelect: () => void;
}

/**
 * Theme picker tile. Renders a self-contained palette preview — chrome swatches
 * + a tiny code snippet coloured with the theme's actual syntax tokens — so the
 * user judges the theme by what it does, not by its name.
 *
 * Important: the preview uses **inline styles** seeded from `theme.{chrome,syntax}`,
 * NOT `var(--*)`. The cards must look right even when the theme is NOT active
 * (every card paints itself in its own palette).
 */
export function ThemeCard({ theme, selected, onSelect }: ThemeCardProps) {
  const { t } = useTranslation();
  const { chrome, syntax } = theme;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={t("settings.appearance.applyTheme", { name: theme.name })}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md border text-left transition-[border-color,box-shadow]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30",
        selected
          ? "border-ink shadow-[0_0_0_1px_var(--ink)]"
          : "border-hairline hover:border-hairline-strong",
      )}
    >
      <div
        className="relative h-[112px] w-full overflow-hidden border-b"
        style={{
          backgroundColor: chrome.canvas,
          borderColor: chrome.hairline,
          fontFamily: "var(--font-mono)",
          fontSize: "10.5px",
          lineHeight: "1.5",
        }}
      >
        {/* Faux chrome strip — surface + hairlines reproduce the app's tab area */}
        <div
          className="flex h-[14px] items-center gap-[3px] border-b px-[6px]"
          style={{
            backgroundColor: chrome.canvasSoft,
            borderColor: chrome.hairlineSoft,
          }}
        >
          <span
            className="h-[5px] w-[5px] rounded-pill"
            style={{ backgroundColor: chrome.danger }}
          />
          <span
            className="h-[5px] w-[5px] rounded-pill"
            style={{ backgroundColor: chrome.warn }}
          />
          <span
            className="h-[5px] w-[5px] rounded-pill"
            style={{ backgroundColor: chrome.success }}
          />
        </div>

        {/* Mini code snippet — covers comment, keyword, fn, string, number, tag */}
        <pre
          className="m-0 px-[8px] pt-[6px]"
          style={{ color: chrome.body, whiteSpace: "pre" }}
        >
          <span style={{ color: syntax.comment, fontStyle: "italic" }}>{"// theme"}</span>
          {"\n"}
          <span style={{ color: syntax.keyword, fontWeight: 600 }}>const</span>{" "}
          <span style={{ color: syntax.definition }}>greet</span>
          <span style={{ color: syntax.operator }}>{" = ("}</span>
          <span style={{ color: syntax.parameter }}>name</span>
          <span style={{ color: syntax.operator }}>{") => "}</span>
          {"\n  "}
          <span style={{ color: syntax.string }}>{`"hi "`}</span>{" "}
          <span style={{ color: syntax.operator }}>+</span>{" "}
          <span style={{ color: syntax.variable }}>name</span>
          {"\n"}
          <span style={{ color: syntax.function, fontWeight: 600 }}>greet</span>
          <span style={{ color: syntax.bracket }}>(</span>
          <span style={{ color: syntax.number }}>42</span>
          <span style={{ color: syntax.bracket }}>)</span>
        </pre>
      </div>

      <div
        className="flex items-center justify-between px-[10px] py-[8px]"
        style={{
          backgroundColor: "var(--surface-card)",
        }}
      >
        <span className="text-caption font-medium text-ink">{theme.name}</span>
        <span className="font-mono text-micro uppercase tracking-label text-muted-soft">
          {theme.kind}
        </span>
      </div>
    </button>
  );
}
