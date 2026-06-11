import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Pencil,
  Pin,
  Trash2,
} from "lucide-react";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
} from "@/components/ui/DropdownMenu";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useAgentNavStore } from "@/features/agent/nav.store";
import { dirKey, useAgentSessionsStore, type SessionRow } from "@/features/agent/sessions.store";
import { cn } from "@/lib/cn";

/** Threads shown per project before the "show all" expander kicks in. */
const VISIBLE_LIMIT = 8;

/**
 * Conversation history for one project directory (Cursor-style): an unsent
 * draft renders first as a pencil row, then the opencode sessions, pinned ones
 * on top. Each thread carries a status dot (warn + pulse while the harness is
 * running it, quiet gray when idle); hovering (or keyboard focus) swaps the
 * timestamp for the pin / archive / more actions. Shared by the sidebar
 * project tree and the Chat pane.
 */
export function ProjectThreads({
  directory,
  showEmptyHint,
}: {
  directory: string | null;
  showEmptyHint?: boolean;
}) {
  const { t } = useTranslation();
  const key = dirKey(directory);

  const baseUrl = useAgentSessionsStore((s) => s.baseUrl);
  const rows = useAgentSessionsStore((s) => s.byDirectory[key]);
  const loaded = useAgentSessionsStore((s) => s.loaded[key]);
  const draft = useAgentSessionsStore((s) => s.drafts[key]);
  const archivedCount = useAgentSessionsStore((s) => (s.archivedByDirectory[key] ?? []).length);
  const loadSessions = useAgentSessionsStore((s) => s.loadSessions);

  const activeSessionId = useAgentChatStore((s) => s.sessionId);
  const activeDirectory = useAgentChatStore((s) => s.directory);

  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (baseUrl && !loaded) void loadSessions(directory);
  }, [baseUrl, loaded, directory, loadSessions]);

  const list = rows ?? [];
  const visible = showAll ? list : list.slice(0, VISIBLE_LIMIT);
  const hiddenCount = list.length - visible.length;

  if (!draft && list.length === 0 && archivedCount === 0) {
    return showEmptyHint && loaded ? (
      <p className="px-[10px] py-[3px] text-caption leading-[1.5] text-muted-soft">
        {t("agent.sidebar.noThreads")}
      </p>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-[1px]">
      {draft ? <DraftRow directory={directory} text={draft} /> : null}
      {visible.map((row) => (
        <ThreadRow
          key={row.id}
          directory={directory}
          row={row}
          active={row.id === activeSessionId && key === dirKey(activeDirectory)}
        />
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="rounded-md px-[10px] py-[4px] text-left text-label text-muted-soft transition-colors duration-fast hover:bg-surface-1 hover:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
        >
          {t("agent.sidebar.showAll", { count: hiddenCount })}
        </button>
      ) : null}
      <ArchivedThreads directory={directory} />
    </div>
  );
}

/** Collapsed "Archived" group at the tail of a project's thread list: opening
 *  an archived chat still works, and the hover action restores it. */
function ArchivedThreads({ directory }: { directory: string | null }) {
  const { t } = useTranslation();
  const key = dirKey(directory);
  const rows = useAgentSessionsStore((s) => s.archivedByDirectory[key]);
  const [open, setOpen] = useState(false);

  const list = rows ?? [];
  if (list.length === 0) return null;

  return (
    <div className="flex flex-col gap-[1px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-[6px] rounded-md px-[10px] py-[4px] text-left text-label text-muted-soft transition-colors duration-fast hover:bg-surface-1 hover:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
      >
        <Icon
          icon={ChevronRight}
          size={11}
          className={cn("shrink-0 transition-transform duration-fast", open && "rotate-90")}
        />
        {t("agent.sidebar.archived", { count: list.length })}
      </button>
      {open
        ? list.map((row) => <ArchivedRow key={row.id} directory={directory} row={row} />)
        : null}
    </div>
  );
}

function ArchivedRow({ directory, row }: { directory: string | null; row: SessionRow }) {
  const { t } = useTranslation();
  const setSection = useAgentNavStore((s) => s.setSection);

  const open = async () => {
    setSection("chat");
    const chat = useAgentChatStore.getState();
    await chat.setDirectory(directory);
    await chat.selectSession(row.id);
  };

  return (
    <div className="group/thread flex w-full items-center gap-[8px] rounded-md py-[5px] pl-[24px] pr-[10px] text-caption text-muted transition-colors duration-fast hover:bg-surface-1">
      <Icon icon={Archive} size={11} strokeWidth={1.75} className="shrink-0 text-muted-soft" />
      <button
        type="button"
        onClick={() => void open()}
        className="min-w-0 flex-1 truncate text-left outline-none"
        title={row.title || undefined}
      >
        {row.title || t("agent.sidebar.untitledChat")}
      </button>
      <span className="hidden shrink-0 group-focus-within/thread:flex group-hover/thread:flex">
        <HoverAction
          label={t("agent.sidebar.unarchive")}
          onClick={() => void useAgentSessionsStore.getState().unarchive(directory, row.id)}
        >
          <Icon icon={ArchiveRestore} size={11} strokeWidth={2} />
        </HoverAction>
      </span>
    </div>
  );
}

/** An unsent composer prompt: pencil icon + the saved text, Cursor-style. */
function DraftRow({ directory, text }: { directory: string | null; text: string }) {
  const { t } = useTranslation();
  const setSection = useAgentNavStore((s) => s.setSection);
  const setDirectory = useAgentChatStore((s) => s.setDirectory);
  const newChat = useAgentChatStore((s) => s.newChat);

  const open = async () => {
    setSection("chat");
    await setDirectory(directory);
    newChat(); // composer rehydrates the draft for this directory
  };

  return (
    <button
      type="button"
      onClick={() => void open()}
      aria-label={t("agent.sidebar.draft")}
      className="group/thread flex w-full items-center gap-[8px] rounded-md px-[10px] py-[5px] text-caption text-muted transition-colors duration-fast hover:bg-surface-1 hover:text-body focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong"
    >
      <Icon icon={Pencil} size={12} strokeWidth={1.75} className="shrink-0 text-muted-soft" />
      <span className="flex-1 truncate text-left italic">{firstLine(text)}</span>
    </button>
  );
}

/** Memoized: the 10s status poll and chat deltas must not re-render every row
 *  of every expanded project group. */
const ThreadRow = memo(function ThreadRow({
  directory,
  row,
  active,
}: {
  directory: string | null;
  row: SessionRow;
  active: boolean;
}) {
  const { t, i18n } = useTranslation();
  const setSection = useAgentNavStore((s) => s.setSection);
  const setDirectory = useAgentChatStore((s) => s.setDirectory);
  const selectSession = useAgentChatStore((s) => s.selectSession);
  const running = useAgentSessionsStore((s) => !!s.runningById[row.id]);
  const setPinned = useAgentSessionsStore((s) => s.setPinned);
  const archive = useAgentSessionsStore((s) => s.archive);

  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  // While the "..." menu is open the hover-actions span must STAY in layout:
  // collapsing it to display:none removes the Radix trigger's box and the
  // portal'd menu falls back to the viewport origin (top-left corner).
  const [menuOpen, setMenuOpen] = useState(false);

  const open = async () => {
    setSection("chat");
    await setDirectory(directory);
    await selectSession(row.id);
  };

  const remove = () => {
    // Deleting the open conversation must also reset the chat surface.
    const chat = useAgentChatStore.getState();
    if (chat.sessionId === row.id) chat.newChat();
    void useAgentSessionsStore.getState().remove(directory, row.id);
  };

  const duplicate = async () => {
    const newId = await useAgentSessionsStore.getState().fork(directory, row.id);
    // Silent failure (best-effort, same as pin/archive); the list reconciles.
    if (newId) {
      setSection("chat");
      await setDirectory(directory);
      await selectSession(newId);
    }
  };

  return (
    <div
      className={cn(
        "group/thread flex w-full items-center gap-[8px] rounded-md px-[10px] py-[5px] text-caption transition-colors duration-fast",
        active ? "bg-surface-2 text-ink" : "text-body hover:bg-surface-1",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-[6px] w-[6px] shrink-0 rounded-pill",
          running ? "bg-warn animate-tab-status-pulse" : "bg-hairline-strong",
        )}
      />
      {renaming ? (
        <RenameInput
          initial={row.title}
          onCommit={(title) => {
            setRenaming(false);
            if (title.trim() && title.trim() !== row.title) {
              void useAgentSessionsStore.getState().rename(directory, row.id, title);
            }
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => void open()}
          className="min-w-0 flex-1 truncate text-left outline-none"
          title={row.title || undefined}
        >
          {row.title || t("agent.sidebar.untitledChat")}
        </button>
      )}

      {/* Timestamp at rest; pin + archive + more on hover OR keyboard focus. */}
      <span
        className={cn(
          "shrink-0 font-mono text-[10px] tabular-nums text-muted-soft group-focus-within/thread:hidden group-hover/thread:hidden",
          menuOpen && "hidden",
        )}
      >
        {row.pinned ? (
          <Icon icon={Pin} size={10} strokeWidth={2} className="inline-block text-muted-soft" />
        ) : (
          agoShort(row.updatedAt, t, i18n.language)
        )}
      </span>
      <span
        className={cn(
          "hidden shrink-0 items-center gap-[2px] group-focus-within/thread:flex group-hover/thread:flex",
          menuOpen && "flex",
        )}
      >
        <HoverAction
          label={row.pinned ? t("agent.sidebar.unpin") : t("agent.sidebar.pin")}
          onClick={() => void setPinned(directory, row.id, !row.pinned)}
        >
          <Icon
            icon={Pin}
            size={11}
            strokeWidth={2}
            className={row.pinned ? "fill-current" : undefined}
          />
        </HoverAction>
        <HoverAction
          label={t("agent.sidebar.archive")}
          onClick={() => setConfirmArchive(true)}
        >
          <Icon icon={Archive} size={11} strokeWidth={2} />
        </HoverAction>
        <DropdownRoot open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownTrigger asChild>
            <IconButton
              size="sm"
              aria-label={t("agent.sidebar.moreActions")}
              onClick={(e) => e.stopPropagation()}
              className="text-muted-soft"
            >
              <Icon icon={MoreHorizontal} size={12} strokeWidth={2} />
            </IconButton>
          </DropdownTrigger>
          <DropdownContent align="end" className="min-w-[160px]">
            <DropdownItem onSelect={() => setRenaming(true)}>
              <Icon icon={Pencil} size={13} className="text-muted" />
              {t("agent.sidebar.rename")}
            </DropdownItem>
            <DropdownItem onSelect={() => void duplicate()}>
              <Icon icon={Copy} size={13} className="text-muted" />
              {t("agent.sidebar.fork")}
            </DropdownItem>
            <DropdownItem onSelect={() => setConfirmDelete(true)}>
              <Icon icon={Trash2} size={13} className="text-danger" />
              <span className="text-danger">{t("agent.sidebar.delete")}</span>
            </DropdownItem>
          </DropdownContent>
        </DropdownRoot>
      </span>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("agent.sidebar.deleteConfirmTitle")}
        description={t("agent.sidebar.deleteConfirmBody", {
          title: row.title || t("agent.sidebar.untitledChat"),
        })}
        confirmLabel={t("agent.sidebar.delete")}
        tone="destructive"
        onConfirm={() => {
          setConfirmDelete(false);
          remove();
        }}
      />
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={t("agent.sidebar.archiveConfirmTitle")}
        description={t("agent.sidebar.archiveConfirmBody", {
          title: row.title || t("agent.sidebar.untitledChat"),
        })}
        confirmLabel={t("agent.sidebar.archive")}
        tone="warning"
        onConfirm={() => {
          setConfirmArchive(false);
          void archive(directory, row.id);
        }}
      />
    </div>
  );
});

/** Inline rename editor for a thread row (Enter commits, Escape cancels). */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value);
        else if (e.key === "Escape") onCancel();
        e.stopPropagation();
      }}
      className="min-w-0 flex-1 rounded-sm border border-hairline bg-surface-1 px-[6px] py-[1px] text-caption text-ink outline-none"
    />
  );
}

function HoverAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <IconButton
      size="sm"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="text-muted-soft"
    >
      {children}
    </IconButton>
  );
}

function firstLine(text: string): string {
  return text.trim().split("\n", 1)[0];
}

/** Compact relative age ("now", "12m", "7h", "3d") for the row's right edge.
 *  Unit letters come from the locale so pt-BR reads naturally ("sem" vs "w"). */
function agoShort(ms: number, t: (key: string) => string, language: string): string {
  if (!ms) return "";
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) return t("agent.sidebar.justNow");
  if (minutes < 60) return `${minutes}${t("agent.sidebar.ago.minute")}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t("agent.sidebar.ago.hour")}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}${t("agent.sidebar.ago.day")}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}${t("agent.sidebar.ago.week")}`;
  try {
    return new Date(ms).toLocaleDateString(language, { day: "numeric", month: "short" });
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}
