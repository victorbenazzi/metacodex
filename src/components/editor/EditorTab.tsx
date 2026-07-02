import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EditorState, Compartment, Annotation, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  highlightTrailingWhitespace,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  searchKeymap,
  highlightSelectionMatches,
  search,
  selectNextOccurrence,
} from "@codemirror/search";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";

import { fsApi } from "@/features/filesystem/filesystem.service";
import { useEditorStore } from "@/features/editor/editor.store";
import { registerEditorSaver } from "@/features/editor/editorSavers";
import { useTabsStore } from "@/components/tabs/tabsStore";
import { PreviewToolbar } from "@/components/previews/PreviewToolbar";
import { useThemeStore } from "@/features/theme/theme.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { usePendingGotoStore } from "@/features/search/search.store";
import { languageFor, languageLabel } from "@/features/editor/language-map";
import { useEditorStatusStore } from "@/features/editor/editor-status.store";
import { gitApi } from "@/features/git/git.service";
import { useGitStore } from "@/features/git/git.store";
import { buildEditorTheme } from "./editorTheme";
import { EditorStatusBar } from "./EditorStatusBar";
import { EditorBreadcrumbs } from "./EditorBreadcrumbs";
import { gitChangeGutter, setHeadContent } from "./gitGutter";
import { stickyScroll } from "./stickyScroll";
import { scopesAt } from "./codeScopes";
import { ext, basename } from "@/lib/path";
import { cn } from "@/lib/cn";
import { getAppCommands } from "@/app/appCommands";

interface EditorTabProps {
  tabId: string;
  path: string;
  projectId: string;
  /** Tab bucket key (`project.id` or WORKSPACE_NULL/preview). Used for store
   *  mutations; NOT the same as projectId, which is "" for preview tabs. */
  projectKey: string;
  /** Preview tab (file outside any project): read/write via the roots-bypassing
   *  preview commands and skip project-only features (git gutter, HEAD diff). */
  preview?: boolean;
  previewGrantId?: string;
  /** Rendered inside MarkdownPreview's source view, which owns its own header ,
   *  suppress the standalone preview toolbar to avoid doubling it up. */
  embedded?: boolean;
}

/**
 * Marks dispatches that originate from the agent-driven external reload path
 * (or from a user-confirmed reload). The updateListener uses this to know it
 * should NOT flag the buffer dirty , the change came from disk, not the user.
 */
const ExternalReload = Annotation.define<true>();

export function EditorTab({
  tabId,
  path,
  projectId,
  projectKey,
  preview = false,
  previewGrantId,
  embedded = false,
}: EditorTabProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeComp = useRef<Compartment | null>(null);
  // Subscribe to the theme id (not just light/dark) so picking a different
  // palette of the same kind still recolors the editor live.
  const themeId = useThemeStore((s) => s.theme.id);
  const editorFontSize = useSettingsDataStore((s) => s.settings.editor.fontSize);
  const editorFontFamily = useSettingsDataStore((s) => s.settings.editor.fontFamily);
  const setLoaded = useEditorStore((s) => s.setLoaded);
  const setDirty = useEditorStore((s) => s.setDirty);
  const setSaving = useEditorStore((s) => s.setSaving);
  const removeEditor = useEditorStore((s) => s.remove);
  const updateTab = useTabsStore((s) => s.updateTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const confirmReload = useEditorStore((s) => s.confirmReload);
  const dismissExternal = useEditorStore((s) => s.dismissExternal);
  const externalState = useEditorStore((s) => s.byTab[tabId]?.externalState ?? "clean");
  const reloadNonce = useEditorStore((s) => s.byTab[tabId]?.reloadNonce ?? 0);
  const pendingGotoLine = usePendingGotoStore((s) => s.byTab[tabId]);
  const setStatus = useEditorStatusStore((s) => s.setStatus);
  const clearStatus = useEditorStatusStore((s) => s.clear);
  // Re-fetch HEAD for the change gutter whenever this project's git state moves
  // (commit, checkout, stage). The object identity changes on every refresh.
  // Preview files live outside any repo , skip git entirely.
  const gitInfo = useGitStore((s) =>
    !preview && projectId ? s.byProject[projectId] : undefined,
  );

  const [loadError, setLoadError] = useState<string | null>(null);
  const [binary, setBinary] = useState<boolean>(false);
  const [savingNotice, setSavingNotice] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{
    encoding: string;
    eol: "LF" | "CRLF";
    size: number;
  } | null>(null);

  // Build (or rebuild on theme change) the editor view
  useEffect(() => {
    let cancelled = false;
    let langExt: Extension | null = null;

    (async () => {
      try {
        if (preview && !previewGrantId) {
          throw new Error("preview grant missing");
        }
        const text = preview
          ? await fsApi.readPreviewText(previewGrantId!, 25 * 1024 * 1024)
          : await fsApi.readFileText(path, 25 * 1024 * 1024);
        if (cancelled) return;
        // Heuristic binary detection on the first 8 KiB
        const sample = text.content.slice(0, 8192);
        let nonPrint = 0;
        for (let i = 0; i < sample.length; i++) {
          const code = sample.charCodeAt(i);
          if ((code < 9 || (code > 13 && code < 32)) && code !== 27) nonPrint++;
        }
        if (sample.length > 0 && nonPrint / sample.length > 0.05) {
          setBinary(true);
          setLoaded(tabId, "");
          return;
        }

        langExt = await languageFor(ext(path));

        // Theme lives in a Compartment so a light/dark switch reconfigures in
        // place (preserving undo history, cursor, and scroll) instead of
        // rebuilding the whole view.
        const themeCompartment = new Compartment();
        themeComp.current = themeCompartment;

        const publishStatus = (state: EditorState) => {
          const sel = state.selection.main;
          const lineObj = state.doc.lineAt(sel.head);
          const selChars = state.selection.ranges.reduce(
            (n, r) => n + (r.to - r.from),
            0,
          );
          setStatus(tabId, {
            line: lineObj.number,
            col: sel.head - lineObj.from + 1,
            selChars,
            ranges: state.selection.ranges.length,
            crumbs: scopesAt(state, sel.head).map((s) => s.name),
          });
        };

        const extensions: Extension[] = [
          lineNumbers(),
          foldGutter(),
          gitChangeGutter(),
          stickyScroll,
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          highlightTrailingWhitespace(),
          EditorView.lineWrapping,
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
            { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
            {
              // Send the selection (or current line) to the active terminal.
              key: "Mod-Shift-Enter",
              preventDefault: true,
              run: (view) => {
                const sel = view.state.selection.main;
                const text = sel.empty
                  ? view.state.doc.lineAt(sel.head).text
                  : view.state.sliceDoc(sel.from, sel.to);
                getAppCommands()?.sendToTerminal(text);
                return true;
              },
            },
            {
              key: "Mod-s",
              preventDefault: true,
              run: (view) => {
                void saveBuffer(view.state.doc.toString());
                return true;
              },
            },
          ]),
          themeCompartment.of(
            buildEditorTheme(useSettingsDataStore.getState().settings.editor),
          ),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              // Skip dirty-marking when the change came from disk (agent edited
              // the file from a terminal tab and the reconciler is silently
              // syncing the buffer). The dot on the tab is reserved for the
              // user's own edits , AI saves are already on disk.
              const isExternal = u.transactions.some((tr) =>
                tr.annotation(ExternalReload),
              );
              if (!isExternal) {
                setDirty(tabId, true);
                updateTab(projectKey, tabId, { dirty: true });
              }
            }
            if (u.docChanged || u.selectionSet) {
              publishStatus(u.state);
            }
          }),
        ];
        if (langExt) extensions.push(langExt);

        const state = EditorState.create({
          doc: text.content,
          extensions,
        });
        const view = new EditorView({ state, parent: hostRef.current! });
        viewRef.current = view;
        setLoaded(tabId, text.content);
        setFileMeta({
          encoding: text.encoding,
          eol: text.content.includes("\r\n") ? "CRLF" : "LF",
          size: text.size,
        });
        publishStatus(view.state);

        // Seed the change gutter with the file's committed (HEAD) text. Preview
        // files aren't in a repo , skip the HEAD lookup entirely.
        if (!preview) {
          void gitApi
            .fileHeadContent(path)
            .then((head) => {
              if (!cancelled) view.dispatch({ effects: setHeadContent.of(head) });
            })
            .catch(() => undefined);
        }

        // If a search-result click scheduled a goto-line for this tab, honour it now.
        const pendingLine = usePendingGotoStore.getState().consume(tabId);
        if (pendingLine && pendingLine > 0) {
          requestAnimationFrame(() => gotoLine(view, pendingLine));
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message ?? String(err));
      }
    })();

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
      removeEditor(tabId);
      clearStatus(tabId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, path]);

  // Reconfigure the theme in place on a theme/font change , no view rebuild,
  // so undo history, cursor, and scroll position survive.
  useEffect(() => {
    const view = viewRef.current;
    const comp = themeComp.current;
    if (!view || !comp) return;
    view.dispatch({
      effects: comp.reconfigure(
        buildEditorTheme({ fontSize: editorFontSize, fontFamily: editorFontFamily }),
      ),
    });
  }, [themeId, editorFontSize, editorFontFamily]);

  // Honour a goto-line scheduled while this tab is already open (the creation
  // effect only sees goto requests present at mount time).
  useEffect(() => {
    if (pendingGotoLine == null) return;
    const view = viewRef.current;
    if (!view) return; // not built yet , the creation effect will consume it
    const line = usePendingGotoStore.getState().consume(tabId);
    if (line && line > 0) requestAnimationFrame(() => gotoLine(view, line));
  }, [pendingGotoLine, tabId]);

  // Refresh the change gutter when this project's git state moves (commit,
  // checkout, …). The initial fetch is handled by the build effect above.
  useEffect(() => {
    if (preview) return;
    const view = viewRef.current;
    if (!view) return;
    void gitApi
      .fileHeadContent(path)
      .then((head) => view.dispatch({ effects: setHeadContent.of(head) }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitInfo, path]);

  // Apply a disk reload requested by the reconciler , either a silent reload
  // (external change while this buffer was clean) or the user clicking
  // "Recarregar" on the conflict banner. Keyed on reloadNonce so it fires once
  // per request without rebuilding the view.
  useEffect(() => {
    if (reloadNonce === 0) return;
    const st = useEditorStore.getState().get(tabId);
    const view = viewRef.current;
    if (!st || st.pendingContent == null || !view) return;
    const next = st.pendingContent;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: {
        anchor: Math.min(sel.anchor, next.length),
        head: Math.min(sel.head, next.length),
      },
      // Tag this transaction so the updateListener skips dirty marking , the
      // change came from disk (agent edit / confirmed reload), not the user.
      annotations: ExternalReload.of(true),
    });
    setLoaded(tabId, next); // resets baseline + clears the external flag
    // The buffer now matches disk again , make sure the tab dot is cleared,
    // even if the user had pending edits before clicking "Reload".
    updateTab(projectKey, tabId, { dirty: false });
    setSavingNotice(t("editor.reloaded"));
    setTimeout(() => setSavingNotice(null), 1400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadNonce]);

  const saveBuffer = async (content: string) => {
    setSaving(tabId, true);
    try {
      if (preview) {
        if (!previewGrantId) throw new Error("preview grant missing");
        await fsApi.writePreviewText(previewGrantId, content);
      } else {
        await fsApi.writeFileText(path, content);
      }
      // The baseline always advances to what we just wrote (that IS what's on
      // disk now). But only clear `dirty` if the live doc still equals `content`:
      // edits typed during the `await` must keep the tab dirty, or we'd strand
      // them (and the reconciler would treat the buffer as clean and reload over
      // them on the next external change).
      setLoaded(tabId, content); // also resets editor.store dirty → false
      const stillMatches = viewRef.current?.state.doc.toString() === content;
      if (stillMatches) {
        updateTab(projectKey, tabId, { dirty: false });
      } else {
        // Edits landed during the await: re-mark dirty in BOTH stores so the
        // dot stays, the saver still fires on quit, and the reconciler won't
        // silently reload over the unsaved tail.
        setDirty(tabId, true);
        updateTab(projectKey, tabId, { dirty: true });
      }
      setSavingNotice(t("editor.saved"));
      setTimeout(() => setSavingNotice(null), 1400);
    } catch (err: any) {
      setSavingNotice(t("editor.saveFailed", { error: err?.message ?? err }));
      setTimeout(() => setSavingNotice(null), 3500);
    } finally {
      setSaving(tabId, false);
    }
  };

  // Expose an imperative flush so "send to project" can persist unsaved edits
  // before the file is moved. No-ops when the buffer is clean.
  const saveBufferRef = useRef(saveBuffer);
  saveBufferRef.current = saveBuffer;
  useEffect(() => {
    return registerEditorSaver(tabId, async () => {
      const view = viewRef.current;
      const st = useEditorStore.getState().get(tabId);
      if (view && st?.dirty) await saveBufferRef.current(view.state.doc.toString());
    });
  }, [tabId]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center px-[24px]">
        <div className="max-w-[440px] space-y-[8px]">
          <p className="editorial-caps text-danger">{t("editor.couldNotRead")}</p>
          <p className="font-mono text-caption text-body">{loadError}</p>
        </div>
      </div>
    );
  }

  if (binary) {
    return (
      <div className="flex h-full items-center justify-center px-[24px]">
        <div className="max-w-[440px] space-y-[8px]">
          <p className="editorial-caps">{t("editor.binaryFile")}</p>
          <p className="font-mono text-caption text-body">
            {t("editor.binaryBody")}
          </p>
          <p className="font-mono text-label text-muted-soft">{path}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col bg-canvas">
      {externalState !== "clean" ? (
        <ExternalChangeBar
          state={externalState}
          onReload={() => confirmReload(tabId)}
          onKeepMine={() => dismissExternal(tabId)}
          onClose={() => closeTab(projectKey, tabId)}
        />
      ) : null}
      {preview && !embedded ? (
        <PreviewToolbar path={path} grantId={previewGrantId} />
      ) : (
        <EditorBreadcrumbs tabId={tabId} fileName={basename(path)} />
      )}
      <div ref={hostRef} className="min-h-0 flex-1" />
      {fileMeta ? (
        <EditorStatusBar
          tabId={tabId}
          language={languageLabel(ext(path))}
          encoding={fileMeta.encoding}
          eol={fileMeta.eol}
          sizeBytes={fileMeta.size}
        />
      ) : null}
      {savingNotice ? (
        <div
          className={cn(
            "pointer-events-none absolute bottom-[32px] right-[14px]",
            "rounded-sm border border-hairline bg-surface-card px-[10px] py-[4px] font-mono text-label text-ink",
          )}
        >
          {savingNotice}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Conflict bar shown when the file diverged on disk underneath the buffer
 * (typically an agent editing it from a terminal tab). Mirrors VS Code's
 * "file changed on disk" affordance.
 */
function ExternalChangeBar({
  state,
  onReload,
  onKeepMine,
  onClose,
}: {
  state: "changed" | "deleted";
  onReload: () => void;
  onKeepMine: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleted = state === "deleted";
  return (
    <div className="flex shrink-0 items-center justify-between gap-[12px] border-b border-hairline bg-surface-card px-[14px] py-[6px]">
      <span className="truncate font-mono text-label text-body">
        {deleted ? t("editor.externalDeleted") : t("editor.externalChanged")}
      </span>
      <div className="flex shrink-0 items-center gap-[6px]">
        {deleted ? (
          <>
            <BarButton onClick={onKeepMine}>{t("editor.keepOpen")}</BarButton>
            <BarButton onClick={onClose} tone="danger">
              {t("editor.closeTab")}
            </BarButton>
          </>
        ) : (
          <>
            <BarButton onClick={onReload} tone="primary">
              {t("editor.reload")}
            </BarButton>
            <BarButton onClick={onKeepMine}>{t("editor.keepMine")}</BarButton>
          </>
        )}
      </div>
    </div>
  );
}

function BarButton({
  children,
  onClick,
  tone = "secondary",
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "secondary" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-[22px] items-center rounded-xs px-[8px] text-label transition-colors",
        tone === "primary" && "bg-surface-strong/60 text-ink hover:bg-surface-strong",
        tone === "danger" && "text-danger hover:bg-surface-strong/45",
        tone === "secondary" && "text-muted hover:bg-surface-strong/55 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Move the cursor to a 1-based line and center it in the viewport. */
function gotoLine(view: EditorView, lineNo: number) {
  if (!lineNo || lineNo <= 0) return;
  try {
    const line = view.state.doc.line(
      Math.min(Math.max(1, lineNo), view.state.doc.lines),
    );
    view.dispatch({
      selection: { anchor: line.from, head: line.from },
      scrollIntoView: true,
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
  } catch {
    // ignore out-of-range lines
  }
}
