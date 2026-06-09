import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Streamdown } from "streamdown";
import { ChevronRight, FileText } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { ChatMessage as Msg, ChatPart, ToolState } from "@/features/agent/chat.store";

import "streamdown/styles.css";

export function ChatMessage({ message }: { message: Msg }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => p.text ?? "").join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-surface-2 px-[14px] py-[9px] text-[14px] leading-[1.55] text-ink">
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[8px]">
      {message.parts.map((part) => (
        <AssistantPart key={part.id} part={part} />
      ))}
    </div>
  );
}

function AssistantPart({ part }: { part: ChatPart }) {
  if (part.type === "step-start" || part.type === "step-finish") return null;
  if (part.type === "reasoning") return <Reasoning part={part} />;
  if (part.type === "tool") return <ToolRow tool={part.tool} />;

  const text = part.text ?? "";
  if (!text) return null;
  return (
    <div className="agent-md text-[14px] leading-[1.65] text-body">
      <Streamdown parseIncompleteMarkdown>{text}</Streamdown>
    </div>
  );
}

/** "Thought 4s" — a calm, collapsible reasoning line (Cursor-style). */
function Reasoning({ part }: { part: ChatPart }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const text = part.text ?? "";
  if (!text.trim()) return null;

  const secs = durationSecs(part.time);
  const label = secs != null ? t("agent.chat.thoughtFor", { sec: secs }) : t("agent.chat.thinking");

  return (
    <div className="self-start">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="-ml-[2px] flex items-center gap-[5px] rounded-sm px-[2px] py-[1px] text-[13px] text-muted hover:text-body"
      >
        <Icon
          icon={ChevronRight}
          size={13}
          className={cn("text-muted-soft transition-transform duration-150", open && "rotate-90")}
        />
        {label}
      </button>
      {open ? (
        <div className="mt-[4px] whitespace-pre-wrap border-l border-hairline-soft pl-[12px] text-[12px] leading-[1.55] text-muted">
          {text}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One tool call. Reads/searches/commands render as compact muted lines; file
 * writes/edits render as a bordered chip with the filename and a green diff
 * count. The `task` tool is hidden here — it surfaces as a subagent card.
 */
function ToolRow({ tool }: { tool?: ToolState }) {
  const { t } = useTranslation();
  if (!tool) return null;
  const view = toolView(tool, t);
  if (view.kind === "hidden") return null;

  if (view.kind === "file") {
    return (
      <div className="flex items-center gap-[8px] self-start rounded-lg border border-hairline bg-surface-card px-[12px] py-[9px] text-[13px]">
        <Icon icon={FileText} size={14} className="shrink-0 text-muted" />
        <span className="truncate font-mono text-ink">{view.target ?? view.verb}</span>
        {view.additions ? (
          <span className="shrink-0 font-mono text-[12px] text-success">+{view.additions}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex max-w-full items-center gap-[6px] self-start text-[13px]">
      <span className="shrink-0 text-muted">{view.verb}</span>
      {view.target ? (
        <span className="truncate font-mono text-[12px] text-muted-soft">{view.target}</span>
      ) : null}
    </div>
  );
}

type ToolView = {
  kind: "file" | "line" | "hidden";
  verb: string;
  target?: string;
  additions?: number;
};

/** Map an opencode tool call to a Cursor-style verb + target. */
function toolView(tool: ToolState, t: TFunction): ToolView {
  const name = tool.name ?? "";
  const input = (tool.input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const base = (p?: string) => (p ? p.split(/[\\/]/).pop() : undefined);
  const running = tool.status === "running" || tool.status === "pending";

  switch (name) {
    case "write": {
      const content = str(input.content);
      return {
        kind: "file",
        verb: t("agent.tool.write"),
        target: base(str(input.filePath)) ?? str(tool.title),
        additions: content ? content.split("\n").length : undefined,
      };
    }
    case "edit":
      return {
        kind: "file",
        verb: t(running ? "agent.tool.editing" : "agent.tool.edit"),
        target: base(str(input.filePath)) ?? str(tool.title),
      };
    case "read":
      return { kind: "line", verb: t("agent.tool.read"), target: base(str(input.filePath)) };
    case "bash":
      return { kind: "line", verb: t("agent.tool.bash"), target: str(input.description) ?? str(input.command) };
    case "grep":
      return { kind: "line", verb: t("agent.tool.search"), target: str(input.pattern) };
    case "glob":
      return { kind: "line", verb: t("agent.tool.searchFiles"), target: str(input.pattern) };
    case "list":
      return { kind: "line", verb: t("agent.tool.list"), target: base(str(input.path)) ?? str(input.path) };
    case "webfetch":
      return { kind: "line", verb: t("agent.tool.fetch"), target: str(input.url) };
    case "websearch":
      return { kind: "line", verb: t("agent.tool.search"), target: str(input.query) };
    case "todowrite":
      return { kind: "line", verb: t("agent.tool.plan") };
    case "skill":
      return { kind: "line", verb: t("agent.tool.skill"), target: str(input.name) };
    case "task":
      return { kind: "hidden", verb: "" };
    default:
      return { kind: "line", verb: str(tool.title) ?? name };
  }
}

/** Whole seconds between a part's start/end window, or null if not finished. */
function durationSecs(time?: { start?: number; end?: number }): number | null {
  if (!time?.start || !time.end) return null;
  return Math.max(1, Math.round((time.end - time.start) / 1000));
}
