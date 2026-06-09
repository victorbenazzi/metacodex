import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { ChatMessage } from "./ChatMessage";
import { PermissionCard } from "./PermissionCard";
import { SubagentGroup } from "./SubagentCard";

export function ChatThread({ className }: { className?: string }) {
  const { t } = useTranslation();
  const thread = useAgentChatStore((s) => s.thread);
  const status = useAgentChatStore((s) => s.status);
  const pendingPermissions = useAgentChatStore((s) => s.pendingPermissions);
  const childThreads = useAgentChatStore((s) => s.childThreads);

  const scrollerRef = useRef<HTMLDivElement>(null);
  // Sticky-bottom: follow the stream only while the user is parked at the bottom.
  // The moment they scroll up, stop yanking them back down — they can read and
  // scroll freely mid-stream, and we resume auto-follow once they return.
  const pinnedRef = useRef(true);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, status, pendingPermissions, childThreads]);

  const last = thread[thread.length - 1];
  const waiting =
    (status === "submitted" || status === "streaming") &&
    (!last || last.role === "user" || last.parts.every((p) => !p.text));

  return (
    <div ref={scrollerRef} onScroll={onScroll} className={cn("overflow-y-auto", className)}>
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-[18px] px-[20px] py-[24px]">
        {thread.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}
        <SubagentGroup />
        {pendingPermissions.map((p) => (
          <PermissionCard key={p.id} prompt={p} />
        ))}
        {waiting ? (
          <div className="flex items-center gap-[8px] text-[13px] text-muted">
            <span className="inline-block h-[7px] w-[7px] animate-pulse rounded-full bg-muted" />
            {t("agent.chat.thinking")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
