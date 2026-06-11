import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircleQuestion } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useAgentChatStore } from "@/features/agent/chat.store";
import type { QuestionPrompt } from "@/features/agent/opencode";

/**
 * Inline answer card for an opencode question request (`question.asked`): the
 * agent is blocked until every question gets an answer (or the whole request
 * is rejected). Options toggle as chips; `multiple` allows several per
 * question, `custom` adds a free-text input that rides as an extra answer.
 */
export function QuestionCard({ prompt }: { prompt: QuestionPrompt }) {
  const { t } = useTranslation();
  const reply = useAgentChatStore((s) => s.replyQuestion);
  const reject = useAgentChatStore((s) => s.rejectQuestion);

  const [selected, setSelected] = useState<string[][]>(() => prompt.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => prompt.questions.map(() => ""));

  const toggle = (qi: number, label: string, multiple: boolean | undefined) => {
    setSelected((prev) =>
      prev.map((labels, i) => {
        if (i !== qi) return labels;
        if (labels.includes(label)) return labels.filter((l) => l !== label);
        return multiple ? [...labels, label] : [label];
      }),
    );
  };

  const answers = prompt.questions.map((_, i) => {
    const extra = custom[i]?.trim();
    return extra ? [...selected[i], extra] : selected[i];
  });
  const complete = answers.every((a) => a.length > 0);

  return (
    <div className="rounded-lg border border-hairline bg-surface-card p-[14px] shadow-elevated">
      <div className="flex items-start gap-[10px]">
        <span className="mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
          <Icon icon={MessageCircleQuestion} size={14} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{t("agent.question.title")}</p>
          <div className="mt-[8px] flex flex-col gap-[12px]">
            {prompt.questions.map((q, qi) => (
              <div key={qi} className="flex flex-col gap-[6px]">
                <p className="text-[13px] leading-[1.5] text-body">{q.question}</p>
                {q.options.length > 0 ? (
                  <div className="flex flex-wrap gap-[6px]">
                    {q.options.map((opt) => {
                      const active = selected[qi].includes(opt.label);
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          aria-pressed={active}
                          title={opt.description}
                          onClick={() => toggle(qi, opt.label, q.multiple)}
                          className={cn(
                            "rounded-md border px-[10px] py-[5px] text-[12px] transition-colors duration-100",
                            active
                              ? "border-ink/40 bg-surface-2 text-ink"
                              : "border-hairline bg-surface-1 text-body hover:bg-surface-2",
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {q.custom ? (
                  <input
                    type="text"
                    value={custom[qi]}
                    onChange={(e) =>
                      setCustom((prev) => prev.map((v, i) => (i === qi ? e.target.value : v)))
                    }
                    placeholder={t("agent.question.customPlaceholder")}
                    className="w-full rounded-md border border-hairline bg-surface-1 px-[10px] py-[6px] text-[12.5px] text-ink outline-none placeholder:text-muted-soft focus:border-hairline-strong"
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-[12px] flex items-center justify-end gap-[8px]">
        <Button size="sm" variant="ghost" onClick={() => void reject(prompt.id)}>
          {t("agent.question.skip")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!complete}
          onClick={() => void reply(prompt.id, answers)}
        >
          {t("agent.question.submit")}
        </Button>
      </div>
    </div>
  );
}
