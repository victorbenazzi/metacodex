import { useEffect, useRef, useState } from "react";
import * as RD from "@radix-ui/react-dialog";
import { Search, X, CaseSensitive, Regex, WholeWord } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useSearchUiStore, usePendingGotoStore } from "@/features/search/search.store";
import { searchApi } from "@/features/search/search.service";
import type { SearchResults } from "@/features/search/search.types";
import { useProjectsStore } from "@/features/projects/project.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { useTabsStore } from "@/components/tabs/tabsStore";
import { basename } from "@/lib/path";
import { ext } from "@/lib/path";
import type { Tab } from "@/components/tabs/types";

export function SearchDialog() {
  const { t } = useTranslation();
  const open = useSearchUiStore((s) => s.open);
  const setOpen = useSearchUiStore((s) => s.setOpen);
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === s.activeProjectId));

  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Debounced search on input change.
  useEffect(() => {
    if (!open || !project) return;
    if (!query.trim()) {
      setResults(null);
      setErr(null);
      return;
    }
    let cancelled = false;
    // Read imperatively so changing it doesn't re-arm this effect while typing.
    const searchDebounceMs =
      useSettingsDataStore.getState().settings.performance.searchDebounceMs;
    const handle = setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        const r = await searchApi.inProject(project.path, query, {
          caseSensitive,
          wholeWord,
          regex,
          maxMatches: 500,
        });
        if (!cancelled) setResults(r);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, searchDebounceMs);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, caseSensitive, wholeWord, regex, project]);

  const openTab = useTabsStore((s) => s.openTab);
  const setPendingGoto = usePendingGotoStore((s) => s.set);

  const onResultClick = (path: string, line: number) => {
    if (!project) return;
    const name = basename(path);
    const id = `f-${path}`;
    const e = ext(name);
    let tab: Tab;
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) {
      tab = { id, kind: "image", title: name, projectId: project.id, path };
    } else if (e === "pdf") {
      tab = { id, kind: "pdf", title: name, projectId: project.id, path };
    } else if (["md", "mdx", "markdown"].includes(e)) {
      // open in source mode so the line jump makes sense
      tab = {
        id,
        kind: "markdown",
        title: name,
        projectId: project.id,
        path,
        mode: "source",
      };
    } else {
      tab = { id, kind: "editor", title: name, projectId: project.id, path };
    }
    setPendingGoto(id, line);
    openTab(project.id, tab);
    setOpen(false);
  };

  return (
    <RD.Root open={open} onOpenChange={setOpen}>
      <RD.Portal>
        <RD.Overlay
          className="fixed inset-0 z-[100] bg-scrim"
        />
        <RD.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-[12vh] z-[101] -translate-x-1/2",
            "max-h-[72vh] w-[min(720px,92vw)] overflow-hidden rounded-md border border-hairline bg-surface-card",
          )}
        >
          <RD.Title className="sr-only">{t("search.title")}</RD.Title>

          <header className="flex items-center gap-10px border-b border-hairline-soft px-14px py-10px">
            <Icon icon={Search} size={14} className="text-muted" />
            <SearchInput
              query={query}
              setQuery={setQuery}
              placeholder={project ? t("search.placeholder", { name: project.name }) : t("search.noProjectOpen")}
              disabled={!project}
            />
            <ToggleButton
              icon={CaseSensitive}
              active={caseSensitive}
              onClick={() => setCaseSensitive((v) => !v)}
              label={t("search.matchCase")}
            />
            <ToggleButton
              icon={WholeWord}
              active={wholeWord}
              onClick={() => setWholeWord((v) => !v)}
              label={t("search.wholeWord")}
            />
            <ToggleButton
              icon={Regex}
              active={regex}
              onClick={() => setRegex((v) => !v)}
              label={t("search.regex")}
            />
            <RD.Close asChild>
              <button
                type="button"
                aria-label={t("search.close")}
                className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-xs text-muted hover:bg-surface-strong/55 hover:text-ink"
              >
                <Icon icon={X} size={12} />
              </button>
            </RD.Close>
          </header>

          <div className="max-h-[60vh] overflow-y-auto px-6px py-6px">
            {!project ? (
              <p className="px-14px py-14px text-caption text-muted">
                {t("search.openToSearch")}
              </p>
            ) : err ? (
              <p className="px-14px py-14px text-caption text-danger">{err}</p>
            ) : busy && !results ? (
              <p className="px-14px py-14px font-mono text-label text-muted-soft">{t("common.searching")}</p>
            ) : !results ? (
              query.trim() ? null : (
                <p className="px-14px py-14px text-caption text-muted">
                  {t("search.typeToSearch")}
                </p>
              )
            ) : results.totalMatches === 0 ? (
              <p className="px-14px py-14px text-caption text-muted">{t("search.noMatches")}</p>
            ) : (
              <ResultsList
                results={results}
                rootPath={project.path}
                onResultClick={onResultClick}
              />
            )}
          </div>

          {results ? (
            <footer className="flex items-center justify-between border-t border-hairline-soft px-14px py-8px font-mono text-label text-muted-soft">
              <span>
                {t("search.summary", { matches: results.totalMatches, files: results.files.length })}
                {results.truncated ? t("search.truncated") : ""}
              </span>
              <span>{results.elapsedMs} ms</span>
            </footer>
          ) : null}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function SearchInput({
  query,
  setQuery,
  placeholder,
  disabled,
}: {
  query: string;
  setQuery: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <input
      ref={ref}
      value={query}
      onChange={(e) => setQuery(e.currentTarget.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(
        "flex-1 bg-transparent text-ui text-ink outline-none placeholder:text-muted-soft",
        "font-mono tracking-tight",
      )}
    />
  );
}

function ToggleButton({
  icon: I,
  active,
  onClick,
  label,
}: {
  icon: any;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        "inline-flex h-[22px] w-[22px] items-center justify-center rounded-xs transition-colors",
        active
          ? "bg-ink text-on-primary"
          : "text-muted hover:bg-surface-strong/55 hover:text-ink",
      )}
    >
      <Icon icon={I} size={12} />
    </button>
  );
}

function ResultsList({
  results,
  rootPath,
  onResultClick,
}: {
  results: SearchResults;
  rootPath: string;
  onResultClick: (path: string, line: number) => void;
}) {
  return (
    <ul className="flex flex-col gap-4px">
      {results.files.map((file) => {
        const rel = relativeTo(file.path, rootPath);
        return (
          <li key={file.path} className="rounded-sm">
            <header className="px-10px py-6px font-mono text-label text-muted">
              <span className="text-ink">{basename(file.path)}</span>{" "}
              <span className="text-muted-soft">{dirOf(rel)}</span>
            </header>
            <ul>
              {file.matches.map((m, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onResultClick(file.path, m.line)}
                    className="group flex w-full items-baseline gap-10px rounded-sm px-10px py-[3px] text-left hover:bg-surface-strong/45"
                  >
                    <span className="w-[36px] shrink-0 text-right font-mono text-micro text-muted-soft">
                      {m.line}
                    </span>
                    <span className="flex-1 truncate font-mono text-caption text-body">
                      {renderHighlight(m.lineText, m.start, m.end)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function renderHighlight(line: string, start: number, end: number) {
  if (end <= start || start >= line.length) return line;
  // Byte offsets are not equivalent to char offsets when multibyte is present,
  // but for most search hits within ASCII-heavy code this is good enough.
  return (
    <>
      <span>{line.slice(0, start)}</span>
      <span className="bg-warn/20 text-ink">{line.slice(start, end)}</span>
      <span>{line.slice(end)}</span>
    </>
  );
}

function relativeTo(path: string, root: string): string {
  const r = root.replace(/\/+$/, "");
  if (path.startsWith(r + "/")) return path.slice(r.length + 1);
  if (path === r) return "";
  return path;
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}
