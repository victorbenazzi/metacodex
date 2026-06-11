import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { ChatMessage } from "./ChatMessage";
import { EditedFilesChip } from "./EditedFilesChip";
import { PermissionCard } from "./PermissionCard";
import { QuestionCard } from "./QuestionCard";
import { RevertBanner } from "./RevertBanner";
import { SubagentGroup } from "./SubagentCard";
import { TodoCard } from "./TodoCard";

export function ChatThread({ className }: { className?: string }) {
  const { t } = useTranslation();
  const thread = useAgentChatStore((s) => s.thread);
  const threadLoading = useAgentChatStore((s) => s.threadLoading);
  const status = useAgentChatStore((s) => s.status);
  const sessionId = useAgentChatStore((s) => s.sessionId);
  const childSessions = useAgentChatStore((s) => s.childSessions);
  const pendingPermissions = useAgentChatStore((s) => s.pendingPermissions);
  const pendingQuestions = useAgentChatStore((s) => s.pendingQuestions);
  const childThreads = useAgentChatStore((s) => s.childThreads);
  const permissionSavedHint = useAgentChatStore((s) => s.permissionSavedHint);

  // The store holds the whole directory's pending prompts; only the active
  // session's (and its subagents') belong in this thread.
  const ownIds = new Set<string>([...(sessionId ? [sessionId] : []), ...childSessions.map((c) => c.id)]);
  const visiblePermissions = pendingPermissions.filter((p) => ownIds.has(p.sessionID));
  const visibleQuestions = pendingQuestions.filter((q) => ownIds.has(q.sessionID));

  const scrollerRef = useRef<HTMLDivElement>(null);
  // Sticky-bottom: follow the stream only while the user is parked at the bottom.
  // The moment they scroll up, stop yanking them back down; they can read and
  // scroll freely mid-stream, and we resume auto-follow once they return.
  const pinnedRef = useRef(true);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // A different session starts pinned at its live edge: without this, a stale
  // "scrolled up" flag from the previous session leaves the new thread parked
  // at an arbitrary offset.
  useEffect(() => {
    pinnedRef.current = true;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessionId]);

  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, status, pendingPermissions, pendingQuestions, childThreads]);

  const last = thread[thread.length - 1];
  const waiting =
    (status === "submitted" || status === "streaming") &&
    visiblePermissions.length === 0 &&
    visibleQuestions.length === 0 &&
    (!last || last.role === "user" || last.parts.every((p) => !p.text));

  return (
    // The scroller is wrapped so the revert banner can sit OUTSIDE it,
    // persistently visible regardless of the scroll position.
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div ref={scrollerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-[18px] px-[20px] py-[24px]">
          {threadLoading && thread.length === 0 ? (
            <ThreadSkeleton />
          ) : (
            <>
              {thread.map((m) => (
                <ChatMessage key={m.id} message={m} />
              ))}
              <EditedFilesChip />
              <TodoCard />
              <SubagentGroup />
              {/* Blocking prompts announce themselves to AT the moment they land. */}
              <div aria-live="polite" className="contents">
                {visiblePermissions.map((p) => (
                  <PermissionCard key={p.id} prompt={p} />
                ))}
                {visibleQuestions.map((q) => (
                  <QuestionCard key={q.id} prompt={q} />
                ))}
              </div>
              {permissionSavedHint ? (
                <div className="flex items-center gap-[6px] text-label text-muted-soft animate-fade-in">
                  <span>{t("agent.permissions.savedHint")}</span>
                  <button
                    type="button"
                    onClick={() => useAgentNavStore.getState().openCustomize("permissions")}
                    className="underline underline-offset-2 hover:text-body"
                  >
                    {t("agent.permissions.savedHintAction")}
                  </button>
                </div>
              ) : null}
              {waiting ? (
                <div className="flex items-center gap-[8px] text-ui text-muted">
                  <span className="inline-block h-[7px] w-[7px] animate-pulse rounded-pill bg-muted" />
                  {t("agent.chat.thinking")}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      <RevertBanner />
    </div>
  );
}

/** Calm placeholder while a selected session's history loads (no hero flash). */
function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-[16px]" aria-hidden>
      <div className="h-[36px] w-[55%] self-end rounded-xl bg-surface-2 opacity-60" />
      <div className="flex flex-col gap-[8px]">
        <div className="h-[12px] w-[80%] rounded-md bg-surface-2 opacity-50" />
        <div className="h-[12px] w-[65%] rounded-md bg-surface-2 opacity-40" />
        <div className="h-[12px] w-[72%] rounded-md bg-surface-2 opacity-30" />
      </div>
      <div className="h-[36px] w-[40%] self-end rounded-xl bg-surface-2 opacity-40" />
      <div className="flex flex-col gap-[8px]">
        <div className="h-[12px] w-[70%] rounded-md bg-surface-2 opacity-30" />
        <div className="h-[12px] w-[50%] rounded-md bg-surface-2 opacity-20" />
      </div>
    </div>
  );
}
