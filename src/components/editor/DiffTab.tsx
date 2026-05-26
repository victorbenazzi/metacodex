import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";

import { fsApi } from "@/features/filesystem/filesystem.service";
import { gitApi } from "@/features/git/git.service";
import { useGitStore } from "@/features/git/git.store";
import { useThemeStore } from "@/features/theme/theme.store";
import { useSettingsDataStore } from "@/features/settings/settings.data.store";
import { PANEL_LIMITS } from "@/features/settings/settings.types";
import { languageFor } from "@/features/editor/language-map";
import { gitColorForBadge, gitStatusLabelKey } from "@/features/git/gitStatus";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import { buildEditorTheme } from "./editorTheme";
import { buildMergeTheme } from "./diffTheme";
import { ext, basename } from "@/lib/path";
import { cn } from "@/lib/cn";

const MAX_DIFF_BYTES = 25 * 1024 * 1024;

interface DiffTabProps {
  path: string;
  projectId: string;
  status: string;
}

/** Read the committed (HEAD) and on-disk (working) text for `path`. */
async function readSides(path: string): Promise<{ head: string; working: string }> {
  const [headRaw, workingRaw] = await Promise.all([
    gitApi.fileHeadContent(path).catch(() => null),
    fsApi
      .readFileText(path, MAX_DIFF_BYTES)
      .then((r) => r.content)
      .catch(() => ""),
  ]);
  // HEAD is null for untracked/new files; working is "" for deleted ones.
  return { head: headRaw ?? "", working: workingRaw ?? "" };
}

/**
 * Read-only side-by-side diff (HEAD ⇄ working tree) built on `@codemirror/merge`.
 * Both editors are non-editable; the merge view owns vertical scroll and aligns
 * unchanged lines. Untracked files diff against an empty HEAD (all additions);
 * deleted files diff an empty working tree (all removals).
 */
export function DiffTab({ path, projectId, status }: DiffTabProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const splitFrameRef = useRef<HTMLDivElement | null>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const themeId = useThemeStore((s) => s.theme.id);
  const editorFontSize = useSettingsDataStore((s) => s.settings.editor.fontSize);
  const editorFontFamily = useSettingsDataStore((s) => s.settings.editor.fontFamily);
  const diffSplitRatio = useSettingsDataStore((s) => s.settings.panels.diffSplitRatio);
  const updateSettings = useSettingsDataStore((s) => s.update);
  const gitInfo = useGitStore((s) => (projectId ? s.byProject[projectId] : undefined));

  const [phase, setPhase] = useState<"loading" | "ready" | "identical" | "error">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Convert a pointer dx (px) to a ratio delta against the current diff
  // viewport width — used by ResizeHandle. Reads width imperatively so a
  // window resize during drag keeps the math honest without re-arming an effect.
  const ratioFromDx = useCallback((dx: number): number => {
    const w = splitFrameRef.current?.clientWidth ?? 0;
    return w > 0 ? dx / w : 0;
  }, []);
  const onSplitChange = useCallback(
    (next: number) => updateSettings("panels", { diffSplitRatio: next }),
    [updateSettings],
  );
  const onSplitReset = useCallback(
    () => updateSettings("panels", { diffSplitRatio: PANEL_LIMITS.diff.default }),
    [updateSettings],
  );

  // Build (or rebuild on theme/font change) the merge view from scratch.
  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setErrorMsg(null);

    (async () => {
      try {
        const { head, working } = await readSides(path);
        if (cancelled) return;
        if (head === working) {
          mergeRef.current?.destroy();
          mergeRef.current = null;
          if (hostRef.current) hostRef.current.innerHTML = "";
          setPhase("identical");
          return;
        }

        const langExt = await languageFor(ext(path)).catch(() => null);
        if (cancelled) return;

        const editorTypography = {
          fontSize: useSettingsDataStore.getState().settings.editor.fontSize,
          fontFamily: useSettingsDataStore.getState().settings.editor.fontFamily,
        };
        // Fresh extension instances per side — CodeMirror extensions are not
        // shareable between two EditorStates.
        const sideExtensions = (): Extension[] => [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lineNumbers(),
          EditorView.lineWrapping,
          buildEditorTheme(editorTypography),
          buildMergeTheme(),
          ...(langExt ? [langExt] : []),
        ];

        mergeRef.current?.destroy();
        const host = hostRef.current;
        if (!host) return;
        host.innerHTML = "";

        const mv = new MergeView({
          a: { doc: head, extensions: sideExtensions() },
          b: { doc: working, extensions: sideExtensions() },
          parent: host,
          orientation: "a-b", // HEAD on the left, working tree on the right
          highlightChanges: true,
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 4 },
        });
        // The merge view's inner editors are height:auto; the outer container
        // owns the scroll so both sides scroll in lockstep.
        mv.dom.style.height = "100%";
        mv.dom.style.overflow = "auto";
        mergeRef.current = mv;
        setPhase("ready");
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(err?.message ?? String(err));
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      mergeRef.current?.destroy();
      mergeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, themeId, editorFontSize, editorFontFamily]);

  // When this project's git state moves (commit, checkout, an agent editing the
  // file from a terminal), refresh both sides in place — no teardown, so the
  // user's scroll position survives.
  useEffect(() => {
    const mv = mergeRef.current;
    if (!mv) return;
    let cancelled = false;
    (async () => {
      const { head, working } = await readSides(path);
      if (cancelled || !mergeRef.current) return;
      if (head !== mv.a.state.doc.toString()) {
        mv.a.dispatch({ changes: { from: 0, to: mv.a.state.doc.length, insert: head } });
      }
      if (working !== mv.b.state.doc.toString()) {
        mv.b.dispatch({ changes: { from: 0, to: mv.b.state.doc.length, insert: working } });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitInfo, path]);

  return (
    <div className="flex h-full w-full flex-col bg-canvas">
      <div className="flex shrink-0 items-center gap-[10px] border-b border-hairline bg-canvas-soft px-[14px] py-[6px]">
        <span className={cn("font-mono text-[10px]", gitColorForBadge(status))}>
          {status}
        </span>
        <span className="truncate font-mono text-[12px] text-ink">{basename(path)}</span>
        <span className="shrink-0 text-[11px] text-muted-soft">
          {t("diff.comparedWithHead")}
        </span>
        <span className="ml-auto shrink-0 editorial-caps text-[10px] text-muted-soft">
          {t(gitStatusLabelKey(status))}
        </span>
      </div>
      <div ref={splitFrameRef} className="relative min-h-0 flex-1">
        <div
          ref={hostRef}
          className="mcx-mergeview h-full w-full"
          // Publish the persisted ratio so the CSS rule on .mcx-mergeview
          // overrides the first editor's flex-basis. Drag updates write back
          // to settings, which re-renders this style.
          style={
            {
              ["--mcx-diff-split-pct" as any]: `${(diffSplitRatio * 100).toFixed(3)}%`,
            } as React.CSSProperties
          }
        />
        {phase === "ready" ? (
          <ResizeHandle
            side="center"
            value={diffSplitRatio}
            min={PANEL_LIMITS.diff.min}
            max={PANEL_LIMITS.diff.max}
            toDelta={ratioFromDx}
            onChange={onSplitChange}
            onReset={onSplitReset}
            ariaLabel={t("diff.resizeSplit")}
            // Free-floating seam: anchor the 8px hit zone so its center sits
            // exactly on the editor boundary. Tracks the persisted ratio via
            // CSS calc — no JS re-layout on each render.
            style={{
              left: `calc(${(diffSplitRatio * 100).toFixed(3)}% - 4px)`,
            }}
          />
        ) : null}
        {phase !== "ready" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-[24px] text-center">
            <span className="font-mono text-[12px] text-muted">
              {phase === "loading"
                ? t("common.loading")
                : phase === "identical"
                  ? t("diff.identical")
                  : t("diff.failed", { error: errorMsg ?? "" })}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
