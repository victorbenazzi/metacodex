import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Braces,
  Folder,
  GitBranch,
  MessageSquare,
  FileText,
  BookOpen,
  SquareSlash,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { fuzzyScore } from "@/lib/fuzzy";
import { searchApi } from "@/features/search/search.service";
import { gitApi } from "@/features/git/git.service";
import { useAgentChatStore } from "@/features/agent/chat.store";
import { useAgentComposerStore } from "@/features/agent/composer.store";
import { dirKey, useAgentSessionsStore } from "@/features/agent/sessions.store";
import { loadCommands, type CommandInfo } from "@/features/agent/commands";
import { findFiles, findSymbols, type SymbolHit } from "@/features/agent/find";
import { loadSkills, type SkillInfo } from "@/features/agent/skills";

import type { ActiveMention, MentionPopupHandle } from "./useMention";

/**
 * Inline autocomplete for the composer: "/" lists skills, "@" lists context
 * sources (project files & folders, current branch, past chats). Anchored to
 * the composer card (not the caret, caret anchoring in a textarea needs a
 * mirror-div hack that isn't worth it), opacity-fade only. The composer's
 * onKeyDown delegates to `handleKey` so arrows/Enter/Escape never reach the
 * submit handler while the popup is open. Plain divs, not a Radix menu, a
 * menu would steal focus from the textarea.
 */

const MAX_FILE_ROWS = 50;

// Project file list cache, shared pattern with the command palette.
const fileCache = new Map<string, { files: string[]; ts: number }>();
const FILE_CACHE_TTL = 4000;

type Row = {
  key: string;
  icon: LucideIcon;
  primary: string;
  secondary?: string;
  /** Small origin pill ("command" / "skill") shown when "/" mixes both kinds. */
  badge?: string;
  run: () => void;
};

export const MentionPopup = forwardRef<
  MentionPopupHandle,
  {
    mention: ActiveMention;
    directory: string | null;
    /** Replace the mention token (trigger..caret) with `replacement`. */
    onReplaceToken: (replacement: string) => void;
    /** Escape pressed at the top level, dismiss until the token changes. */
    onDismiss: () => void;
  }
>(function MentionPopup({ mention, directory, onReplaceToken, onDismiss }, ref) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [commands, setCommands] = useState<CommandInfo[] | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  /** Harness-ranked file paths (relative). Null = the Rust fallback is active. */
  const [serverFiles, setServerFiles] = useState<string[] | null>(null);
  const [symbols, setSymbols] = useState<SymbolHit[] | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [section, setSection] = useState<null | "files" | "chats" | "symbols">(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fileAbortRef = useRef<AbortController | null>(null);
  const symbolAbortRef = useRef<AbortController | null>(null);

  const sessions = useAgentSessionsStore((s) => s.byDirectory[dirKey(directory)] ?? []);
  const sessionsLoaded = useAgentSessionsStore((s) => s.loaded[dirKey(directory)] ?? false);

  // Lazy data: skills for "/", files + branch + past chats for "@".
  useEffect(() => {
    if (mention.trigger === "/") {
      void loadSkills().then(setSkills);
      // Harness commands ride the same trigger; no sidecar = no commands.
      const base = useAgentChatStore.getState().baseUrl;
      if (base) void loadCommands(base, directory).then(setCommands);
      else setCommands([]);
      return;
    }
    if (!directory) return;
    const cached = fileCache.get(directory);
    if (cached && Date.now() - cached.ts < FILE_CACHE_TTL) {
      setFiles(cached.files);
    } else {
      void searchApi
        .listFiles(directory)
        .then((f) => {
          fileCache.set(directory, { files: f, ts: Date.now() });
          setFiles(f);
        })
        .catch(() => setFiles([]));
    }
    void gitApi
      .branchList(directory)
      .then((rows) => setBranch(rows.find((b) => b.current)?.name ?? rows[0]?.name ?? null))
      .catch(() => setBranch(null));
    if (!sessionsLoaded) void useAgentSessionsStore.getState().loadSessions(directory);
  }, [mention.trigger, directory, sessionsLoaded]);

  const root = directory?.replace(/\/+$/, "") ?? "";
  const query = mention.query.trim();

  // Server-side file search (the agent's own view of the project, gitignore
  // applied): 120ms debounce per keystroke, aborting the previous inflight.
  // An abort keeps the last good list on screen (anti-flicker); a real
  // failure arms the Rust `list_files` fallback above.
  useEffect(() => {
    if (mention.trigger !== "@") return;
    const wantsFiles = section === "files" || (!section && query !== "");
    if (!wantsFiles) return;
    const base = useAgentChatStore.getState().baseUrl;
    if (!base) return;
    const timer = setTimeout(() => {
      fileAbortRef.current?.abort();
      const ctl = new AbortController();
      fileAbortRef.current = ctl;
      findFiles(base, directory, query, ctl.signal)
        .then((rows) => {
          if (!ctl.signal.aborted) setServerFiles(rows);
        })
        .catch((e) => {
          if (!(e instanceof DOMException && e.name === "AbortError")) setServerFiles(null);
        });
    }, 120);
    return () => clearTimeout(timer);
  }, [mention.trigger, section, query, directory]);

  // Workspace symbols (needs a warm language server on the harness side).
  useEffect(() => {
    if (mention.trigger !== "@" || section !== "symbols") return;
    const base = useAgentChatStore.getState().baseUrl;
    if (!base) {
      setSymbols([]);
      return;
    }
    const timer = setTimeout(() => {
      symbolAbortRef.current?.abort();
      const ctl = new AbortController();
      symbolAbortRef.current = ctl;
      findSymbols(base, directory, query, ctl.signal)
        .then((rows) => {
          if (!ctl.signal.aborted) setSymbols(rows);
        })
        .catch((e) => {
          if (!(e instanceof DOMException && e.name === "AbortError")) setSymbols([]);
        });
    }, 120);
    return () => clearTimeout(timer);
  }, [mention.trigger, section, query, directory]);

  const rows = useMemo<Row[]>(() => {
    const composer = useAgentComposerStore.getState();

    if (mention.trigger === "/") {
      if (skills === null && commands === null) return [];
      // Executable commands first (the harness's skill view is redundant with
      // the Skills rows below). On a name collision the command wins: the
      // homonymous skill row is dropped and the badge says what runs.
      const cmds = (commands ?? []).filter((c) => c.source !== "skill");
      const cmdRanked = cmds
        .map((c) => ({ c, sc: query ? fuzzyScore(query, `${c.name} ${c.description ?? ""}`) : 0 }))
        .filter((x) => x.sc >= 0);
      if (query) cmdRanked.sort((a, b) => b.sc - a.sc);
      const cmdNames = new Set(cmds.map((c) => c.name));
      const commandRows: Row[] = cmdRanked.map(({ c }) => ({
        key: `cmd-${c.name}`,
        icon: SquareSlash,
        primary: c.name,
        secondary: c.description,
        badge: t("agent.composer.originCommand"),
        run: () => onReplaceToken(`/${c.name} `),
      }));
      const ranked = (skills ?? [])
        .filter((s) => !cmdNames.has(s.name))
        .map((s) => ({ s, sc: query ? fuzzyScore(query, `${s.name} ${s.description}`) : 0 }))
        .filter((x) => x.sc >= 0);
      if (query) ranked.sort((a, b) => b.sc - a.sc);
      const skillRows: Row[] = ranked.map(({ s }) => ({
        key: s.path,
        icon: BookOpen,
        primary: s.name,
        secondary: s.description,
        badge: commandRows.length > 0 ? t("agent.composer.originSkill") : undefined,
        run: () => onReplaceToken(`/${s.name} `),
      }));
      return [...commandRows, ...skillRows];
    }

    const fileRow = (abs: string, rel: string): Row => ({
      key: abs,
      icon: FileText,
      primary: rel.split("/").pop() ?? rel,
      secondary: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "",
      run: () => {
        composer.addPaths([abs]);
        onReplaceToken("");
      },
    });

    const fileRows = (): Row[] => {
      // Harness results come server-ranked and relative; keep their order
      // (no local fuzzy) and resolve to absolute for the attachment pipeline.
      if (serverFiles !== null) {
        return serverFiles.slice(0, MAX_FILE_ROWS).map((rel) => {
          const abs = rel.startsWith("/") ? rel : root ? `${root}/${rel}` : rel;
          const shown = abs.startsWith(root) ? abs.slice(root.length).replace(/^\/+/, "") : rel;
          return fileRow(abs, shown);
        });
      }
      const ranked = files
        .map((abs) => {
          const rel = abs.startsWith(root) ? abs.slice(root.length).replace(/^\/+/, "") : abs;
          return { abs, rel, sc: query ? fuzzyScore(query, rel) : 0 };
        })
        .filter((r) => r.sc >= 0);
      if (query) ranked.sort((a, b) => b.sc - a.sc);
      return ranked.slice(0, MAX_FILE_ROWS).map((r) => fileRow(r.abs, r.rel));
    };

    const symbolRows = (): Row[] => {
      if (symbols === null) return [];
      return symbols.map((s) => {
        const rel = s.path.startsWith(root)
          ? s.path.slice(root.length).replace(/^\/+/, "")
          : s.path;
        return {
          key: `${s.path}:${s.line}:${s.name}`,
          icon: Braces,
          primary: s.name,
          secondary: `${rel}:${s.line + 1}`,
          run: () => {
            composer.addSymbolContext({ name: s.name, path: s.path, line: s.line });
            onReplaceToken("");
          },
        };
      });
    };

    const chatRows = (): Row[] => {
      const ranked = sessions
        .map((s) => ({ s, sc: query ? fuzzyScore(query, s.title) : 0 }))
        .filter((x) => x.sc >= 0);
      if (query) ranked.sort((a, b) => b.sc - a.sc);
      return ranked.map(({ s }) => ({
        key: s.id,
        icon: MessageSquare,
        primary: s.title || s.id,
        run: () => {
          composer.addChatContext(s.id, s.title || s.id);
          onReplaceToken("");
        },
      }));
    };

    if (section === "files") return fileRows();
    if (section === "chats") return chatRows();
    if (section === "symbols") return symbolRows();
    // Typing skips the category level and goes straight to files (the dominant use).
    if (query) return fileRows();

    const categories: Row[] = [
      {
        key: "cat-files",
        icon: Folder,
        primary: t("agent.composer.mentionFiles"),
        secondary: t("agent.composer.mentionFilesHint"),
        run: () => setSection("files"),
      },
    ];
    categories.push({
      key: "cat-symbols",
      icon: Braces,
      primary: t("agent.composer.mentionSymbols"),
      secondary: t("agent.composer.mentionSymbolsHint"),
      run: () => setSection("symbols"),
    });
    if (branch) {
      categories.push({
        key: "cat-branch",
        icon: GitBranch,
        primary: t("agent.composer.mentionBranch"),
        secondary: branch,
        run: () => {
          if (directory) composer.addBranchContext(directory, branch);
          onReplaceToken("");
        },
      });
    }
    categories.push({
      key: "cat-chats",
      icon: MessageSquare,
      primary: t("agent.composer.mentionPastChats"),
      secondary: t("agent.composer.mentionPastChatsHint"),
      run: () => setSection("chats"),
    });
    return categories;
  }, [mention.trigger, skills, commands, files, serverFiles, symbols, sessions, branch, section, query, root, directory, t, onReplaceToken]);

  // Reset the highlight whenever the result set changes shape.
  useEffect(() => {
    setActive(0);
  }, [query, section, mention.trigger]);

  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active, rows.length]);

  // "/" with a query that matches nothing: vanish entirely so typing paths
  // like /Users/... isn't nagged by an empty panel. Same for "@" at the top
  // level: a zero-match query hides the popup so Enter falls through to the
  // submit instead of being swallowed by a dead panel. Inside an explicitly
  // opened section (browsing) the "No results" row stays.
  const hidden =
    (mention.trigger === "/" &&
      ((skills === null && commands === null) || (query !== "" && rows.length === 0))) ||
    (mention.trigger === "@" && !section && query !== "" && rows.length === 0);

  useImperativeHandle(
    ref,
    () => ({
      handleKey: (e) => {
        if (hidden) return false;
        if (e.key === "ArrowDown") {
          setActive((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
          return true;
        }
        if (e.key === "ArrowUp") {
          setActive((i) => Math.max(i - 1, 0));
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          if (rows.length === 0) return true;
          rows[Math.min(active, rows.length - 1)]?.run();
          return true;
        }
        if (e.key === "Escape") {
          if (section) setSection(null);
          else onDismiss();
          return true;
        }
        return false;
      },
    }),
    [rows, active, section, hidden, onDismiss],
  );

  if (hidden) return null;

  return (
    <div
      className="absolute inset-x-0 bottom-full z-30 mb-[8px] animate-fade-in overflow-hidden rounded-md border border-hairline bg-surface-card shadow-elevated"
      onMouseDown={(e) => e.preventDefault() /* keep the textarea focused */}
    >
      <div
        ref={listRef}
        role="listbox"
        id="agent-mention-listbox"
        aria-label={t("agent.composer.mentionLabel")}
        className="max-h-[280px] overflow-y-auto p-[5px]"
      >
        {rows.length === 0 ? (
          <div className="px-[10px] py-[8px] text-[12px] text-muted">
            {section === "symbols"
              ? t("agent.composer.mentionSymbolsEmpty")
              : t("agent.composer.mentionNoResults")}
          </div>
        ) : (
          rows.map((row, i) => (
            <button
              key={row.key}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={row.run}
              className={cn(
                "flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[7px] text-left text-[13px] text-ink",
                i === active && "bg-surface-strong/55",
              )}
            >
              <Icon icon={row.icon} size={14} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{row.primary}</span>
              {row.secondary ? (
                <span className="max-w-[45%] shrink-0 truncate text-[11px] text-muted">
                  {row.secondary}
                </span>
              ) : null}
              {row.badge ? (
                <span className="shrink-0 rounded-full border border-hairline px-[6px] py-[1px] text-[10px] text-muted-soft">
                  {row.badge}
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
});
