import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Streamdown } from "streamdown";
import {
  AlertTriangle,
  ChevronRight,
  FileText,
  GitFork,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useAgentChatStore } from "@/features/agent/chat.store";
import type { ChatMessage as Msg, ChatPart, ToolState } from "@/features/agent/chat.store";
import { useAgentSessionsStore } from "@/features/agent/sessions.store";
import { editedFilesFromMessages } from "@/features/agent/opencode";
import { streamdownCodePlugin } from "@/features/agent/streamdownCode";
import { useStreamdownTranslations } from "@/features/agent/streamdownI18n";

import { relPath } from "./SessionDiffDialog";

import "streamdown/styles.css";
import "@/styles/streamdown.css";

// Singleton: a new object per render would defeat streamdown's internal memo.
const SD_PLUGINS = { code: streamdownCodePlugin };

/**
 * One thread message. Memoized: the SSE reducers keep untouched messages
 * reference-stable, so during streaming only the message receiving deltas
 * re-renders instead of the whole thread.
 */
export const ChatMessage = memo(function ChatMessage({ message }: { message: Msg }) {
  const { t } = useTranslation();
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }
  return (
    <div className="group/msg flex flex-col gap-[8px]">
      {message.parts.map((part) => (
        <AssistantPart key={part.id} part={part} />
      ))}
      {message.error ? (
        <div className="flex items-start gap-[6px] self-start rounded-md border border-danger/30 bg-danger/8 px-[10px] py-[7px] text-caption text-danger">
          <Icon icon={AlertTriangle} size={13} className="mt-[1px] shrink-0" />
          <span className="min-w-0 break-words">{message.error}</span>
        </div>
      ) : null}
      {message.finish === "length" ? (
        <span className="self-start text-label text-muted-soft">{t("agent.chat.truncated")}</span>
      ) : null}
      <MetaFooter message={message} />
    </div>
  );
});

/** Hover-revealed turn metadata: model, token counts, cost. Only once the turn
 *  carries any of them (live turns fill in on `message.updated`). */
function MetaFooter({ message }: { message: Msg }) {
  const bits: string[] = [];
  if (message.modelID) {
    bits.push(message.variant ? `${message.modelID} (${message.variant})` : message.modelID);
  }
  const tk = message.tokens;
  if (tk && (tk.input || tk.output)) {
    bits.push(`${fmtTokens(tk.input)} in / ${fmtTokens(tk.output)} out`);
  }
  if (typeof message.cost === "number" && message.cost > 0) {
    bits.push(`$${message.cost.toFixed(message.cost < 0.1 ? 4 : 2)}`);
  }
  if (bits.length === 0) return null;
  return (
    <span className="self-start text-label text-muted-soft opacity-0 transition-opacity duration-fast group-hover/msg:opacity-100">
      {bits.join(" · ")}
    </span>
  );
}

function fmtTokens(n?: number): string {
  if (!n) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function UserMessage({ message }: { message: Msg }) {
  const { t } = useTranslation();
  // Context parts (branch summary, past-chat digest) ride as separate text
  // parts before the typed prompt; keep them visually separated.
  const text = message.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("\n\n");
  const files = message.parts.filter((p) => p.type === "file" && p.file);
  return (
    <div className="group/msg flex flex-col items-end gap-[6px]">
      {files.length > 0 ? (
        <div className="flex max-w-[80%] flex-wrap justify-end gap-[6px]">
          {files.map((p) => (
            <FileChip key={p.id} file={p.file!} />
          ))}
        </div>
      ) : null}
      {text ? (
        message.shell ? (
          <div className="flex max-w-[80%] items-baseline gap-[8px] rounded-xl rounded-br-sm border border-warn/25 bg-surface-2 px-[14px] py-[9px] font-mono text-ui leading-[1.55] text-ink">
            <span aria-hidden className="select-none text-muted-soft">
              $
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{text}</span>
          </div>
        ) : (
          <div className="max-w-[80%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-surface-2 px-[14px] py-[9px] text-content leading-[1.55] text-ink">
            {text}
          </div>
        )
      ) : null}
      {message.relay ? (
        <span className="text-label text-muted-soft">{t("agent.chat.visionRelayNote")}</span>
      ) : null}
      <UserMessageActions message={message} />
    </div>
  );
}

/**
 * Hover actions under a user message: restore-to-here, edit-and-resend, and
 * (on the last exchange) delete. Hidden while streaming, while a revert is
 * already active, and until the server echo has adopted the bubble's real
 * messageID (`local-` ids have nothing server-side to act on).
 */
function UserMessageActions({ message }: { message: Msg }) {
  const { t } = useTranslation();
  const status = useAgentChatStore((s) => s.status);
  const sessionId = useAgentChatStore((s) => s.sessionId);
  const revertActive = useAgentChatStore((s) => s.revert !== null);
  const directory = useAgentChatStore((s) => s.directory);
  const isLastUser = useAgentChatStore((s) => {
    for (let i = s.thread.length - 1; i >= 0; i--) {
      if (s.thread[i].role === "user") return s.thread[i].id === message.id;
    }
    return false;
  });
  const [confirm, setConfirm] = useState<null | "revert" | "edit" | "delete">(null);
  // The files the rollback would restore, derived from the discarded turns'
  // edit/write tool calls at open time (swarm child edits aren't counted; the
  // summary is informative, the revert itself rolls back everything).
  const [affected, setAffected] = useState<string[]>([]);

  // A session switch invalidates an open confirm (it points at another thread).
  useEffect(() => setConfirm(null), [sessionId]);

  if (status !== "idle" || !sessionId || revertActive || message.id.startsWith("local-")) {
    return null;
  }

  const openWithSummary = (kind: "revert" | "edit") => {
    const thread = useAgentChatStore.getState().thread;
    const idx = thread.findIndex((m) => m.id === message.id);
    setAffected(idx === -1 ? [] : editedFilesFromMessages(thread.slice(idx)));
    setConfirm(kind);
  };

  // The typed prompt is the LAST text part (context parts ride before it).
  const typedText = [...message.parts].reverse().find((p) => p.type === "text" && p.text)?.text ?? "";

  const filesSummary =
    affected.length === 0 ? (
      <span>{t("agent.chat.revert.noFiles")}</span>
    ) : (
      <div className="space-y-[4px]">
        <span>{t("agent.chat.revert.filesAffected", { count: affected.length })}</span>
        <ul className="space-y-[2px]">
          {affected.slice(0, 8).map((f) => (
            <li key={f} className="truncate font-mono text-label">
              {relPath(f, directory)}
            </li>
          ))}
          {affected.length > 8 ? (
            <li className="text-label text-muted-soft">
              {t("agent.chat.revert.moreFiles", { count: affected.length - 8 })}
            </li>
          ) : null}
        </ul>
      </div>
    );

  const actionButton = (
    icon: typeof RotateCcw,
    label: string,
    onClick: () => void,
  ) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-sm p-[4px] text-muted-soft hover:bg-surface-2 hover:text-ink"
    >
      <Icon icon={icon} size={13} />
    </button>
  );

  return (
    <>
      <div className="flex items-center gap-[2px] opacity-0 transition-opacity duration-fast group-hover/msg:opacity-100">
        {typedText
          ? actionButton(Pencil, t("agent.chat.edit.action"), () => openWithSummary("edit"))
          : null}
        {actionButton(RotateCcw, t("agent.chat.revert.restoreHere"), () =>
          openWithSummary("revert"),
        )}
        {actionButton(GitFork, t("agent.chat.forkFromHere"), () => {
          // Non-destructive (a copy is created); no confirm needed. Components
          // may use both stores; the one-way rule is module-level only.
          void (async () => {
            const { directory: dir, sessionId: sid, selectSession } =
              useAgentChatStore.getState();
            if (!sid) return;
            const newId = await useAgentSessionsStore.getState().fork(dir, sid, message.id);
            if (newId) await selectSession(newId);
          })();
        })}
        {isLastUser
          ? actionButton(Trash2, t("agent.chat.deleteMsg.action"), () => setConfirm("delete"))
          : null}
      </div>
      <ConfirmDialog
        open={confirm === "revert"}
        onOpenChange={(open) => setConfirm(open ? "revert" : null)}
        title={t("agent.chat.revert.confirmTitle")}
        description={t("agent.chat.revert.confirmBody")}
        details={filesSummary}
        confirmLabel={t("agent.chat.revert.restoreHere")}
        tone="warning"
        onConfirm={() => {
          void useAgentChatStore.getState().revertTo(message.id);
        }}
      />
      <ConfirmDialog
        open={confirm === "edit"}
        onOpenChange={(open) => setConfirm(open ? "edit" : null)}
        title={t("agent.chat.edit.confirmTitle")}
        description={t("agent.chat.edit.confirmBody")}
        details={filesSummary}
        confirmLabel={t("agent.chat.edit.action")}
        tone="warning"
        onConfirm={() => {
          void (async () => {
            const store = useAgentChatStore.getState();
            const ok = await store.revertTo(message.id);
            if (ok && typedText) store.setComposerPrefill(typedText);
          })();
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => setConfirm(open ? "delete" : null)}
        title={t("agent.chat.deleteMsg.confirmTitle")}
        description={t("agent.chat.deleteMsg.confirmBody")}
        confirmLabel={t("agent.chat.deleteMsg.action")}
        tone="destructive"
        onConfirm={() => {
          void useAgentChatStore.getState().deleteLastExchange();
        }}
      />
    </>
  );
}

/** An attachment chip: image thumbnail for data: URLs, name chip otherwise. */
function FileChip({ file }: { file: NonNullable<ChatPart["file"]> }) {
  const { t } = useTranslation();
  const isImage = (file.mime ?? "").startsWith("image/") && (file.url ?? "").startsWith("data:");
  if (isImage) {
    return (
      <img
        src={file.url}
        alt={file.filename ?? ""}
        draggable={false}
        className="max-h-[180px] max-w-[240px] rounded-lg border border-hairline object-cover"
      />
    );
  }
  return (
    <div className="flex items-center gap-[6px] rounded-md border border-hairline bg-surface-card px-[10px] py-[6px] text-caption">
      <Icon icon={FileText} size={13} className="shrink-0 text-muted" />
      <span className="max-w-[200px] truncate font-mono text-ink">
        {file.filename ?? t("agent.chat.fileFallback")}
      </span>
    </div>
  );
}

function AssistantPart({ part }: { part: ChatPart }) {
  const { t } = useTranslation();
  const translations = useStreamdownTranslations();
  switch (part.type) {
    case "step-start":
    case "step-finish":
    case "snapshot":
    case "subtask":
    case "agent":
    case "other":
      return null;
    case "reasoning":
      return <Reasoning part={part} />;
    case "tool":
      return <ToolRow tool={part.tool} time={part.time} />;
    case "file":
      return part.file ? (
        <div className="self-start">
          <FileChip file={part.file} />
        </div>
      ) : null;
    case "patch":
      return (
        <div className="flex items-center gap-[8px] self-start rounded-lg border border-hairline bg-surface-card px-[12px] py-[9px] text-ui">
          <Icon icon={FileText} size={14} className="shrink-0 text-muted" />
          <span className="text-muted">{t("agent.chat.patch")}</span>
        </div>
      );
    case "retry":
      return (
        <div className="flex items-center gap-[6px] self-start text-caption text-muted-soft">
          <Icon icon={RotateCcw} size={12} className="shrink-0" />
          {t("agent.chat.retried")}
        </div>
      );
    case "compaction":
      return (
        <div className="flex items-center gap-[8px] self-stretch text-label text-muted-soft">
          <span className="h-px flex-1 bg-hairline-soft" />
          {t("agent.chat.compacted")}
          <span className="h-px flex-1 bg-hairline-soft" />
        </div>
      );
    default: {
      const text = part.text ?? "";
      if (!text) return null;
      return (
        <div className="agent-md text-content leading-[1.65] text-body">
          <Streamdown parseIncompleteMarkdown plugins={SD_PLUGINS} translations={translations}>
            {text}
          </Streamdown>
        </div>
      );
    }
  }
}

/** "Thought 4s": a calm, collapsible reasoning line (Cursor-style). */
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
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="-ml-[2px] flex items-center gap-[5px] rounded-sm px-[2px] py-[1px] text-ui text-muted hover:text-body"
      >
        <Icon
          icon={ChevronRight}
          size={13}
          className={cn("text-muted-soft transition-transform duration-fast", open && "rotate-90")}
        />
        {label}
      </button>
      {open ? (
        <div className="mt-[4px] whitespace-pre-wrap border-l border-hairline-soft pl-[12px] text-caption leading-[1.55] text-muted">
          {text}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One tool call. Reads/searches/commands render as compact muted lines; file
 * writes/edits render as a bordered chip with the filename and a green diff
 * count. The `task` tool is hidden here; it surfaces as a subagent card.
 * Status-aware: pending/running show a spinner, an errored call tints danger
 * and exposes the tool's output as the failure detail.
 */
function ToolRow({ tool, time }: { tool?: ToolState; time?: ChatPart["time"] }) {
  const { t } = useTranslation();
  if (!tool) return null;
  const view = toolView(tool, t);
  if (view.kind === "hidden") return null;

  const running = tool.status === "running" || tool.status === "pending";
  const failed = tool.status === "error";

  if (failed) {
    return <ToolError tool={tool} view={view} />;
  }

  const secs = durationSecs(time);

  if (view.kind === "file") {
    return (
      <div className="flex items-center gap-[8px] self-start rounded-lg border border-hairline bg-surface-card px-[12px] py-[9px] text-ui">
        {running ? (
          <Icon icon={Loader2} size={14} className="shrink-0 animate-spin text-muted" />
        ) : (
          <Icon icon={FileText} size={14} className="shrink-0 text-muted" />
        )}
        <span className="truncate font-mono text-ink">{view.target ?? view.verb}</span>
        {view.additions ? (
          <span className="shrink-0 font-mono text-caption text-success">+{view.additions}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex max-w-full items-center gap-[6px] self-start text-ui">
      {running ? <Icon icon={Loader2} size={12} className="shrink-0 animate-spin text-muted" /> : null}
      <span className="shrink-0 text-muted">{view.verb}</span>
      {view.target ? (
        <span className="truncate font-mono text-caption text-muted-soft">{view.target}</span>
      ) : null}
      {!running && secs != null && secs >= 3 ? (
        <span className="shrink-0 text-label text-muted-soft">{secs}s</span>
      ) : null}
    </div>
  );
}

/** A failed tool call: danger tint + the tool output as expandable detail. */
function ToolError({ tool, view }: { tool: ToolState; view: ToolView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const detail = typeof tool.output === "string" ? tool.output.trim() : "";
  return (
    <div className="flex flex-col gap-[4px] self-start">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => detail && setOpen((o) => !o)}
        className={cn(
          "flex max-w-full items-center gap-[6px] text-left text-ui",
          detail ? "cursor-pointer" : "cursor-default",
        )}
      >
        <Icon icon={AlertTriangle} size={13} className="shrink-0 text-danger" />
        <span className="shrink-0 text-danger">
          {t("agent.tool.failed", { tool: view.verb })}
        </span>
        {view.target ? (
          <span className="truncate font-mono text-caption text-muted-soft">{view.target}</span>
        ) : null}
        {detail ? (
          <Icon
            icon={ChevronRight}
            size={12}
            className={cn(
              "shrink-0 text-muted-soft transition-transform duration-fast",
              open && "rotate-90",
            )}
          />
        ) : null}
      </button>
      {open && detail ? (
        <pre className="max-h-[200px] max-w-full overflow-auto whitespace-pre-wrap border-l border-danger/30 pl-[12px] font-mono text-label leading-[1.5] text-muted">
          {detail.slice(0, 4000)}
        </pre>
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
