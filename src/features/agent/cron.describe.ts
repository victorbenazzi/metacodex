import cronstrue from "cronstrue/i18n";

/**
 * Turn a 5-field cron expression into a human sentence (localized), and report
 * whether it is a well-formed standard expression. Shared by the cron field
 * (live preview), the task card (schedule label), and the dialog (Save gate).
 *
 * We enforce exactly 5 fields so the stored string stays portable to external
 * schedulers (trigger.dev / Railway) and matches the Rust evaluator, which is the
 * real authority on value ranges and rejects anything malformed on save.
 *
 * Memoized: the sidebar re-describes every task on each poll tick, and a
 * cronstrue parse per task per render adds up. Pure inputs, bounded cache.
 */
export interface CronDescription {
  text: string;
  valid: boolean;
}

const cache = new Map<string, CronDescription>();
const CACHE_CAP = 200;

export function describeCron(expr: string, language: string): CronDescription {
  const cron = expr.trim();
  if (!cron) return { text: "", valid: false };
  if (cron.split(/\s+/).length !== 5) return { text: "", valid: false };

  const locale = language.toLowerCase().startsWith("pt") ? "pt_BR" : "en";
  const key = `${locale} ${cron}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let out: CronDescription;
  try {
    const text = cronstrue.toString(cron, {
      locale,
      use24HourTimeFormat: true,
      throwExceptionOnParseError: true,
      verbose: false,
    });
    out = { text, valid: true };
  } catch {
    out = { text: "", valid: false };
  }
  if (cache.size > CACHE_CAP) cache.clear();
  cache.set(key, out);
  return out;
}
