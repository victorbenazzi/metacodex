import { useTranslation } from "react-i18next";

import { describeCron } from "@/features/agent/cron.describe";
import { cn } from "@/lib/cn";

interface Preset {
  key: string;
  expr: string;
}

/** Quick picks that fill the cron field. All standard 5-field expressions. */
const PRESETS: Preset[] = [
  { key: "everyMinute", expr: "* * * * *" },
  { key: "every15m", expr: "*/15 * * * *" },
  { key: "hourly", expr: "0 * * * *" },
  { key: "daily9", expr: "0 9 * * *" },
  { key: "weekdays9", expr: "0 9 * * 1-5" },
  { key: "weeklyMon", expr: "0 9 * * 1" },
  { key: "monthly1", expr: "0 9 1 * *" },
];

/**
 * Cron schedule editor: preset chips + a raw 5-field expression input + a live,
 * localized human-readable description (the reassurance the expression is right).
 * The raw string is what gets stored and is portable to any external scheduler.
 */
export function CronField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const desc = describeCron(value, i18n.language);
  const showError = value.trim().length > 0 && !desc.valid;

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-wrap gap-[6px]">
        {PRESETS.map((p) => {
          const active = value.trim() === p.expr;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(p.expr)}
              className={cn(
                "h-[26px] rounded-pill border px-[11px] text-[11.5px] font-medium transition-colors duration-150",
                active
                  ? "border-ink bg-ink text-on-primary"
                  : "border-hairline-strong text-body hover:bg-surface-strong/45",
              )}
            >
              {t(`agent.scheduled.presets.${p.key}`)}
            </button>
          );
        })}
      </div>

      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0 9 * * 1-5"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={t("agent.scheduled.dialog.schedule")}
        aria-invalid={showError}
        className={cn(
          "h-[38px] rounded-md border bg-surface-1 px-[12px] font-mono text-[13px] tracking-[0.02em] text-ink outline-none transition-colors duration-150",
          showError
            ? "border-danger focus:border-danger"
            : "border-hairline-strong focus:border-ink",
        )}
      />

      <p
        className={cn(
          "min-h-[16px] text-[12px] leading-[1.5]",
          showError ? "text-danger" : desc.valid ? "text-body" : "text-muted",
        )}
      >
        {showError
          ? t("agent.scheduled.dialog.cronInvalid")
          : desc.valid
            ? desc.text
            : t("agent.scheduled.dialog.cronHint")}
      </p>
    </div>
  );
}
