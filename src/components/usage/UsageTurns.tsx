import { useTranslation } from "react-i18next";
import type { UsageTurn } from "@/features/usage/usage.types";

export function UsageTurns({ turns, projectName }: { turns: UsageTurn[]; projectName: (id: string | null) => string }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const counter = (value: string | null) => value != null && /^\d+$/.test(value) ? number.format(BigInt(value)) : t("usage.unknown");
  return <section className="mt-24px space-y-12px border-t border-hairline-soft pt-20px">
    <h3 className="text-ui font-medium">{t("usage.cursorTurns")}</h3>
    <p className="text-caption leading-relaxed text-muted">{t("usage.cursorTurnsDescription")}</p>
    {turns.length ? <div className="overflow-x-auto">
      <table className="w-full text-left text-caption">
        <thead className="text-muted"><tr className="border-b border-hairline-soft">
          <th className="pb-10px pr-12px font-normal">{t("usage.session")}</th>
          {["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"].map(key => <th key={key} className="pb-10px pl-12px text-right font-normal">{t(`usage.${key}`)}</th>)}
        </tr></thead>
        <tbody>{turns.map(turn => <tr key={`${turn.sessionId}:${turn.generationId}`} className="border-b border-hairline-soft">
          <td className="py-12px pr-12px">
            <p className="text-body">{turn.model ?? t("usage.unknown")}</p>
            <p className="mt-4px font-mono text-label text-muted">{turn.sessionId.slice(0, 8)}</p>
            <p className="mt-4px text-label text-muted">{projectName(turn.projectId)} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(turn.observedAt * 1000)}</p>
          </td>
          {[turn.inputTokens, turn.outputTokens, turn.cacheReadTokens, turn.cacheWriteTokens].map((value, index) => <td key={index} className="pl-12px text-right font-mono tabular-nums">{counter(value)}</td>)}
        </tr>)}</tbody>
      </table>
    </div> : <p className="py-10px text-caption text-muted">{t("usage.noTurns")}</p>}
  </section>;
}
