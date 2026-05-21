import { useEffect, useRef, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";

import { fsApi } from "@/features/filesystem/filesystem.service";
import { useEditorStore } from "@/features/editor/editor.store";
import { useTabsStore, WORKSPACE_NULL } from "@/components/tabs/tabsStore";
import { useThemeStore } from "@/features/theme/theme.store";
import { usePendingGotoStore } from "@/features/search/search.store";
import { languageFor } from "@/features/editor/language-map";
import { buildEditorTheme } from "./editorTheme";
import { ext } from "@/lib/path";
import { cn } from "@/lib/cn";

interface EditorTabProps {
  tabId: string;
  path: string;
  projectId: string;
}

export function EditorTab({ tabId, path, projectId }: EditorTabProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeEffective = useThemeStore((s) => s.effective);
  const setLoaded = useEditorStore((s) => s.setLoaded);
  const setDirty = useEditorStore((s) => s.setDirty);
  const setSaving = useEditorStore((s) => s.setSaving);
  const removeEditor = useEditorStore((s) => s.remove);
  const updateTab = useTabsStore((s) => s.updateTab);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [binary, setBinary] = useState<boolean>(false);
  const [savingNotice, setSavingNotice] = useState<string | null>(null);

  // Build (or rebuild on theme change) the editor view
  useEffect(() => {
    let cancelled = false;
    let langExt: Extension | null = null;

    (async () => {
      try {
        const text = await fsApi.readFileText(path, 25 * 1024 * 1024);
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

        const extensions: Extension[] = [
          lineNumbers(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
            {
              key: "Mod-s",
              preventDefault: true,
              run: (view) => {
                void saveBuffer(view.state.doc.toString());
                return true;
              },
            },
          ]),
          buildEditorTheme(),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              setDirty(tabId, true);
              updateTab(projectId ?? WORKSPACE_NULL, tabId, { dirty: true });
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

        // If a search-result click scheduled a goto-line for this tab, honour it now.
        const pendingLine = usePendingGotoStore.getState().consume(tabId);
        if (pendingLine && pendingLine > 0) {
          requestAnimationFrame(() => {
            try {
              const line = view.state.doc.line(
                Math.min(Math.max(1, pendingLine), view.state.doc.lines),
              );
              view.dispatch({
                selection: { anchor: line.from, head: line.from },
                scrollIntoView: true,
                effects: EditorView.scrollIntoView(line.from, { y: "center" }),
              });
              view.focus();
            } catch {
              // ignore
            }
          });
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, path, themeEffective]);

  const saveBuffer = async (content: string) => {
    setSaving(tabId, true);
    try {
      await fsApi.writeFileText(path, content);
      setDirty(tabId, false);
      updateTab(projectId ?? WORKSPACE_NULL, tabId, { dirty: false });
      setSavingNotice("Saved");
      setTimeout(() => setSavingNotice(null), 1400);
    } catch (err: any) {
      setSavingNotice(`Save failed: ${err?.message ?? err}`);
      setTimeout(() => setSavingNotice(null), 3500);
    } finally {
      setSaving(tabId, false);
    }
  };

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center px-[24px]">
        <div className="max-w-[440px] space-y-[8px]">
          <p className="editorial-caps text-danger">could not read</p>
          <p className="font-mono text-[12px] text-body">{loadError}</p>
        </div>
      </div>
    );
  }

  if (binary) {
    return (
      <div className="flex h-full items-center justify-center px-[24px]">
        <div className="max-w-[440px] space-y-[8px]">
          <p className="editorial-caps">binary file</p>
          <p className="font-mono text-[12px] text-body">
            This file looks binary. metacodex MVP only edits text files.
          </p>
          <p className="font-mono text-[11px] text-muted-soft">{path}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-canvas">
      <div ref={hostRef} className="h-full w-full" />
      {savingNotice ? (
        <div
          className={cn(
            "pointer-events-none absolute bottom-[10px] right-[14px]",
            "rounded-sm border border-hairline bg-surface-card px-[10px] py-[4px] font-mono text-[11px] text-ink",
          )}
        >
          {savingNotice}
        </div>
      ) : null}
    </div>
  );
}
