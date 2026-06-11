import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ListPlus, Square, X } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { cn } from "@/lib/cn";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { dirKey, useAgentSessionsStore } from "@/features/agent/sessions.store";
import { useAgentComposerStore } from "@/features/agent/composer.store";
import { buildOutgoingParts } from "@/features/agent/attachments";
import {
  branchContextText,
  chatContextText,
  symbolContextText,
} from "@/features/agent/contextParts";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import type { AgentMode } from "@/features/agent/opencode";

import { ModelPicker } from "./composer/ModelPicker";
import { VariantPicker } from "./composer/VariantPicker";
import { ProjectPicker } from "./composer/ProjectPicker";
import { PermissionPicker } from "./composer/PermissionPicker";
import { BranchPicker } from "./composer/BranchPicker";
import { AttachmentChips } from "./composer/AttachmentChips";
import { PlusMenu } from "./composer/PlusMenu";
import { MentionPopup } from "./composer/MentionPopup";
import { QueuedPrompts } from "./composer/QueuedPrompts";
import { detectMention, type MentionPopupHandle } from "./composer/useMention";

/** Tallest the textarea grows before it starts scrolling internally. */
const MAX_TEXTAREA_PX = 200;

/**
 * The Agent View composer. Sends prompts to the opencode runtime via the chat
 * store; the reply streams back through the shared event subscription. The
 * control cluster (model, project, permission, mode) drives the harness for
 * real: each choice rides the next session/message to opencode.
 *
 * Auto-grows with the prompt up to `MAX_TEXTAREA_PX`, then scrolls. `compact`
 * is the docked-below-the-thread variant: a slimmer, Cursor-like footprint that
 * keeps every control, used once the conversation has started.
 */
export function AgentComposer({
  autoFocus,
  compact,
}: {
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const send = useAgentChatStore((s) => s.send);
  const stop = useAgentChatStore((s) => s.stop);
  const status = useAgentChatStore((s) => s.status);
  const error = useAgentChatStore((s) => s.error);
  const mode = useSettingsDataStore((s) => s.settings.agent.mode);
  const update = useSettingsDataStore((s) => s.update);
  const directory = useAgentChatStore((s) => s.directory);

  const sessionId = useAgentChatStore((s) => s.sessionId);
  const uiStateHydrated = useAgentSessionsStore((s) => s.uiStateHydrated);

  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // "/" and "@" inline autocomplete: caret position is tracked in state (the
  // DOM selection isn't reactive); Escape dismisses until the token changes.
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const mentionRef = useRef<MentionPopupHandle>(null);
  const rawMention = detectMention(text, caret);
  const mention = rawMention && rawMention.start !== dismissedAt ? rawMention : null;

  const attachments = useAgentComposerStore((s) => s.attachments);
  const dragHover = useAgentComposerStore((s) => s.dragHover);

  const busy = status === "submitted" || status === "streaming";
  const attachmentLoading = attachments.some((a) => "status" in a && a.status === "loading");
  const hasSendableAttachment = attachments.some((a) => !("status" in a) || a.status === "ready");
  const canSend = !busy && !attachmentLoading && (!!text.trim() || hasSendableAttachment);
  // While a turn runs, Enter (and the queue button) enqueue instead of sending.
  const canQueue = busy && !attachmentLoading && (!!text.trim() || hasSendableAttachment);

  // "!" as the first character = inline shell mode ("!git status"); "!!"
  // escapes a literal "!" and a "!" mid-text never triggers. Shell commands
  // are not queueable: while busy the submit is a no-op (the hint says so).
  const shellCommand = (() => {
    const tt = text.trimStart();
    if (!tt.startsWith("!") || tt.startsWith("!!") || tt.length < 2) return null;
    const cmd = tt.slice(1).trim();
    return cmd || null;
  })();

  // Drafts: an unsent new-chat prompt survives per project (the pencil row in
  // the sidebar). Only the new-chat composer participates; typing mid-thread
  // is not a draft. Switching project swaps to that project's saved draft;
  // hydration only fills an untouched composer.
  const directoryKey = dirKey(directory);
  const prevKeyRef = useRef(directoryKey);
  useEffect(() => {
    void useAgentSessionsStore.getState().hydrateUiState();
  }, []);
  useEffect(() => {
    if (sessionId) return;
    const draft = useAgentSessionsStore.getState().drafts[directoryKey] ?? "";
    if (prevKeyRef.current !== directoryKey) {
      prevKeyRef.current = directoryKey;
      setText(draft);
    } else {
      setText((cur) => (cur.trim() ? cur : draft));
    }
  }, [directoryKey, uiStateHydrated, sessionId]);

  // Injected text from the chat store (queue restore, edit and resend): merged
  // above whatever is already typed, then consumed so it fires exactly once.
  // Drafts can't serve this path, they only hydrate when no session is active.
  const composerPrefill = useAgentChatStore((s) => s.composerPrefill);
  useEffect(() => {
    if (composerPrefill == null || !composerPrefill.trim()) return;
    setText((cur) => (cur.trim() ? `${composerPrefill}\n\n${cur}` : composerPrefill));
    useAgentChatStore.getState().setComposerPrefill(null);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const pos = el.value.length;
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }, [composerPrefill]);

  // Grow to fit the content, capped at MAX (past which the textarea scrolls).
  // Runs on every text change, including the reset to "" after submit.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

  /** Insert a token (skill mention, etc.) at the caret and refocus. */
  const insertToken = (token: string) => {
    const el = taRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${token}${text.slice(end)}`;
    setText(next);
    if (!sessionId) useAgentSessionsStore.getState().setDraft(directory, next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length;
      el?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  /** Replace the active mention token (trigger..caret) with `replacement`. */
  const replaceMentionToken = (replacement: string) => {
    if (!mention) return;
    const next = `${text.slice(0, mention.start)}${replacement}${text.slice(mention.end)}`;
    setText(next);
    if (!sessionId) useAgentSessionsStore.getState().setDraft(directory, next);
    setDismissedAt(null);
    requestAnimationFrame(() => {
      const el = taRef.current;
      el?.focus();
      const pos = mention.start + replacement.length;
      el?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  // Synchronous single-flight guard: `status` only covers the chat store side;
  // this stops a double Enter from racing two buildOutgoingParts/send calls in
  // the same frame.
  const sendingRef = useRef(false);

  const submit = () => {
    if (sendingRef.current) return;
    // Shell mode bypasses parts entirely; attachments stay in the composer.
    if (shellCommand !== null) {
      if (busy || attachmentLoading) return;
      sendingRef.current = true;
      const cmd = shellCommand;
      setText("");
      if (!sessionId) useAgentSessionsStore.getState().clearDraft(directory);
      void useAgentChatStore
        .getState()
        .sendShell(cmd)
        .then((ok) => {
          if (!ok) setText((cur) => cur || `!${cmd}`);
        })
        .finally(() => {
          sendingRef.current = false;
        });
      return;
    }
    if (!canSend && !canQueue) return;
    sendingRef.current = true;
    // Snapshot the mode: the running turn may settle while parts build; an
    // enqueue stays an enqueue (the store drains an idle queue immediately).
    const queueing = busy;
    const value = text.trim();
    const pending = useAgentComposerStore.getState().attachments;
    // Optimistic clear (snappy); restored if the send never dispatches (e.g.
    // session create failed) so nothing the user wrote is lost.
    setText("");
    if (!sessionId) useAgentSessionsStore.getState().clearDraft(directory);
    void (async () => {
      try {
        const parts = await buildOutgoingParts(pending, {
          branchContext: branchContextText,
          chatContext: chatContextText,
          symbolContext: symbolContextText,
        });
        if (queueing) {
          useAgentChatStore.getState().enqueue(value, parts);
          const composer = useAgentComposerStore.getState();
          for (const a of pending) composer.remove(a.id);
          return;
        }
        const ok = await send(value, parts);
        if (ok) {
          // Remove only the chips this send consumed; anything attached while
          // the (possibly multi-second, vision-relay) send was in flight stays.
          const composer = useAgentComposerStore.getState();
          for (const a of pending) composer.remove(a.id);
        } else {
          setText((cur) => cur || value);
          if (!sessionId && value) {
            useAgentSessionsStore.getState().setDraft(directory, value);
          }
        }
      } finally {
        sendingRef.current = false;
      }
    })();
  };

  return (
    <div className="w-full max-w-[760px]">
      <div
        className={cn(
          "relative rounded-xl border border-hairline bg-surface-card shadow-elevated",
          dragHover && "border-ink/40",
          shellCommand !== null && "border-warn/45",
        )}
      >
        {mention ? (
          <MentionPopup
            ref={mentionRef}
            mention={mention}
            directory={directory}
            onReplaceToken={replaceMentionToken}
            onDismiss={() => setDismissedAt(mention.start)}
          />
        ) : null}
        <QueuedPrompts />
        <AttachmentChips />
        <textarea
          ref={taRef}
          value={text}
          autoFocus={autoFocus}
          rows={1}
          aria-label={t("agent.composer.placeholder")}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={!!mention}
          aria-controls={mention ? "agent-mention-listbox" : undefined}
          placeholder={dragHover ? t("agent.composer.dropToAttach") : t("agent.composer.placeholder")}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            if (dismissedAt !== null && !detectMention(e.target.value, e.target.selectionStart ?? 0)) {
              setDismissedAt(null);
            }
            if (!sessionId) useAgentSessionsStore.getState().setDraft(directory, e.target.value);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={(e) => {
            // IME composition (CJK candidate confirm, dead-key accents) emits
            // Enter/Arrow keydowns that belong to the IME, never to us.
            if (e.nativeEvent.isComposing) return;
            if (mention && mentionRef.current?.handleKey(e)) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            let found = false;
            for (const item of items) {
              if (item.kind === "file" && item.type.startsWith("image/")) {
                const blob = item.getAsFile();
                if (blob) {
                  found = true;
                  useAgentComposerStore.getState().addPastedImage(blob);
                }
              }
            }
            if (found) e.preventDefault();
          }}
          style={{ maxHeight: MAX_TEXTAREA_PX }}
          className={cn(
            "block w-full resize-none overflow-y-auto bg-transparent text-[14px] leading-[1.5] text-ink outline-none placeholder:text-muted-soft",
            compact ? "min-h-[40px] px-[14px] pt-[10px]" : "min-h-[64px] px-[16px] pt-[14px]",
          )}
        />

        <div
          className={cn(
            "flex items-center gap-[8px]",
            compact ? "px-[10px] pb-[10px] pt-[2px]" : "px-[12px] pb-[12px] pt-[4px]",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-[8px]">
            <PlusMenu onInsertToken={insertToken} />
            <ModelPicker />
            <VariantPicker />
            <PermissionPicker />
          </div>

          <div className="flex shrink-0 items-center gap-[10px]">
            <Segmented
              size="sm"
              ariaLabel={t("agent.composer.modeLabel")}
              value={mode}
              onChange={(value: AgentMode) => update("agent", { mode: value })}
              options={[
                { value: "agent", label: t("agent.composer.agent") },
                { value: "swarm", label: t("agent.composer.agentSwarm") },
              ]}
            />
            {busy ? (
              <>
                {canQueue ? (
                  <button
                    type="button"
                    onClick={submit}
                    title={t("agent.composer.queue.enqueue")}
                    aria-label={t("agent.composer.queue.enqueue")}
                    className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-hairline text-muted hover:bg-surface-2 hover:text-ink"
                  >
                    <Icon icon={ListPlus} size={14} />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void stop()}
                  aria-label={t("agent.composer.stop")}
                  className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full bg-ink text-on-primary"
                >
                  <Icon icon={Square} size={12} strokeWidth={3} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label={t("agent.composer.send")}
                className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full bg-ink text-on-primary disabled:bg-surface-2 disabled:text-muted-soft"
              >
                <Icon icon={ArrowUp} size={16} strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>
      </div>

      {shellCommand !== null ? (
        <p className="mt-[6px] px-[2px] text-[11px] text-muted-soft">
          {busy ? t("agent.composer.shellBusyHint") : t("agent.composer.shellHint")}
        </p>
      ) : canQueue && text.trim() ? (
        <p className="mt-[6px] px-[2px] text-[11px] text-muted-soft">
          {t("agent.composer.queue.hint")}
        </p>
      ) : null}

      {error ? (
        <div className="mt-[8px] flex items-start justify-between gap-[10px] rounded-md border border-danger/30 bg-danger/5 px-[12px] py-[8px]">
          <p className="min-w-0 text-[12px] leading-[1.5] text-danger">{error}</p>
          <button
            type="button"
            aria-label={t("agent.chat.dismissError")}
            onClick={() => useAgentChatStore.setState({ error: null })}
            className="shrink-0 rounded-sm p-[2px] text-danger/70 hover:bg-danger/10 hover:text-danger"
          >
            <Icon icon={X} size={12} />
          </button>
        </div>
      ) : null}

      <div className="mt-[8px] flex items-center gap-[8px] px-[2px]">
        <ProjectPicker />
        {directory ? (
          <>
            <span className="h-[12px] w-px shrink-0 bg-hairline" />
            <BranchPicker root={directory} />
          </>
        ) : null}
      </div>
    </div>
  );
}
