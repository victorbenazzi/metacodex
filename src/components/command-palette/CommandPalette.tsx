import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import * as RD from "@radix-ui/react-dialog";
import { File, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/Icon";
import { useCommandPaletteStore } from "@/features/command-palette/command-palette.store";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSearchUiStore } from "@/features/search/search.store";
import { useSettingsStore } from "@/features/settings/settings.store";
import { useThemeStore } from "@/features/theme/theme.store";
import { searchApi } from "@/features/search/search.service";
import { fuzzyScore } from "@/lib/fuzzy";
import { basename } from "@/lib/path";

interface PaletteCommand {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

type PaletteItem =
  | { kind: "file"; key: string; primary: string; secondary: string; abs: string }
  | { kind: "command"; key: string; primary: string; secondary: string; cmd: PaletteCommand };

// Runtime handlers attached by AppShell on window.__metacodex.
interface MetacodexApi {
  newTerminal?: () => void;
  openFolder?: () => void;
  closeActiveTab?: () => void;
  openFile?: (path: string, name: string) => void;
}
function api(): MetacodexApi {
  return ((window as unknown as { __metacodex?: MetacodexApi }).__metacodex) ?? {};
}

// Per-project file-list cache so reopening the palette feels instant.
const fileCache = new Map<string, { files: string[]; ts: number }>();
const CACHE_TTL = 4000;
const MAX_RESULTS = 200;

// Localized at render time (titleKey → t). `run` never depends on language.
const COMMAND_DEFS: { id: string; titleKey: string; hint?: string; run: () => void }[] = [
  { id: "go-to-file", titleKey: "commandPalette.goToFile", hint: "⌘P", run: () => useCommandPaletteStore.getState().openFiles() },
  { id: "new-terminal", titleKey: "commandPalette.newTerminal", hint: "⌘T", run: () => api().newTerminal?.() },
  { id: "open-folder", titleKey: "commandPalette.openFolder", hint: "⌘O", run: () => api().openFolder?.() },
  { id: "search", titleKey: "commandPalette.searchFiles", hint: "⇧⌘F", run: () => useSearchUiStore.getState().setOpen(true) },
  { id: "settings", titleKey: "commandPalette.settings", hint: "⌘,", run: () => useSettingsStore.getState().setOpen(true) },
  { id: "close-tab", titleKey: "commandPalette.closeTab", hint: "⌘W", run: () => api().closeActiveTab?.() },
  {
    id: "toggle-theme",
    titleKey: "commandPalette.toggleTheme",
    run: () => {
      const theme = useThemeStore.getState();
      theme.setMode(theme.effective === "dark" ? "light" : "dark");
    },
  },
];

export function CommandPalette() {
  const { t } = useTranslation();
  const open = useCommandPaletteStore((s) => s.open);
  const mode = useCommandPaletteStore((s) => s.mode);
  const close = useCommandPaletteStore((s) => s.close);
  const projectPath = useProjectsStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.path,
  );

  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Reset query + selection whenever the palette (re)opens or switches mode.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open, mode]);

  // Load the project's file list when entering files mode.
  useEffect(() => {
    if (!open || mode !== "files" || !projectPath) return;
    const cached = fileCache.get(projectPath);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setFiles(cached.files);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchApi
      .listFiles(projectPath)
      .then((f) => {
        if (cancelled) return;
        fileCache.set(projectPath, { files: f, ts: Date.now() });
        setFiles(f);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, projectPath]);

  const root = projectPath?.replace(/\/+$/, "") ?? "";

  const commands = useMemo<PaletteCommand[]>(
    () => COMMAND_DEFS.map((c) => ({ id: c.id, title: t(c.titleKey), hint: c.hint, run: c.run })),
    [t],
  );

  const items = useMemo<PaletteItem[]>(() => {
    const trimmed = query.trim();
    if (mode === "files") {
      const ranked = files
        .map((abs) => {
          const rel = relativeTo(abs, root);
          return { abs, rel, sc: trimmed ? fuzzyScore(trimmed, rel) : 0 };
        })
        .filter((r) => r.sc >= 0);
      if (trimmed) ranked.sort((a, b) => b.sc - a.sc);
      return ranked.slice(0, MAX_RESULTS).map((r) => ({
        kind: "file" as const,
        key: r.abs,
        primary: basename(r.abs),
        secondary: dirOf(r.rel),
        abs: r.abs,
      }));
    }
    const ranked = commands.map((c) => ({
      c,
      sc: trimmed ? fuzzyScore(trimmed, c.title) : 0,
    })).filter((x) => x.sc >= 0);
    if (trimmed) ranked.sort((a, b) => b.sc - a.sc);
    return ranked.map((x) => ({
      kind: "command" as const,
      key: x.c.id,
      primary: x.c.title,
      secondary: x.c.hint ?? "",
      cmd: x.c,
    }));
  }, [mode, files, query, root, commands]);

  // Keep the active index in range as the list changes.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Scroll the active row into view.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    if (item.kind === "file") api().openFile?.(item.abs, basename(item.abs));
    else item.cmd.run();
    close();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  };

  const filesDisabled = mode === "files" && !projectPath;

  return (
    <RD.Root open={open} onOpenChange={(o) => !o && close()}>
      <RD.Portal>
        <RD.Overlay
          className={cn(
            "fixed inset-0 z-[100] bg-[rgba(38,37,30,0.32)]",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        <RD.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className={cn(
            "fixed left-1/2 top-[12vh] z-[101] -translate-x-1/2",
            "max-h-[72vh] w-[min(640px,92vw)] overflow-hidden rounded-lg border border-hairline bg-surface-card",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        >
          <RD.Title className="sr-only">
            {mode === "files" ? t("commandPalette.titleFiles") : t("commandPalette.titleCommands")}
          </RD.Title>

          <header className="flex items-center gap-[10px] border-b border-hairline-soft px-[14px] py-[10px]">
            <span className="font-mono text-[12px] text-muted-soft">
              {mode === "files" ? "›" : "⌘"}
            </span>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder={
                mode === "files"
                  ? projectPath
                    ? t("commandPalette.placeholderFiles")
                    : t("commandPalette.placeholderNoProject")
                  : t("commandPalette.placeholderCommand")
              }
              disabled={filesDisabled}
              className="flex-1 bg-transparent font-mono text-[13px] tracking-tight text-ink outline-none placeholder:text-muted-soft"
            />
          </header>

          <ul ref={listRef} className="max-h-[60vh] overflow-y-auto px-[6px] py-[6px]">
            {mode === "files" && loading && items.length === 0 ? (
              <li className="px-[14px] py-[12px] font-mono text-[11px] text-muted-soft">
                {t("common.loading")}
              </li>
            ) : items.length === 0 ? (
              <li className="px-[14px] py-[12px] text-[12px] text-muted">
                {filesDisabled ? t("commandPalette.noProjectOpen") : t("commandPalette.nothingFound")}
              </li>
            ) : (
              items.map((it, i) => (
                <li key={it.key}>
                  <button
                    type="button"
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(i)}
                    className={cn(
                      "flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[6px] text-left",
                      i === active ? "bg-surface-strong/55" : "hover:bg-surface-strong/35",
                    )}
                  >
                    <Icon
                      icon={it.kind === "file" ? File : ChevronRight}
                      size={12}
                      className="shrink-0 text-muted-soft"
                    />
                    <span className="truncate text-[13px] text-ink">{it.primary}</span>
                    {it.secondary ? (
                      <span className="ml-auto shrink-0 truncate pl-[12px] font-mono text-[11px] text-muted-soft">
                        {it.secondary}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function relativeTo(path: string, root: string): string {
  if (root && path.startsWith(root + "/")) return path.slice(root.length + 1);
  return path;
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}
